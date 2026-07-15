/**
 * roster — roster kanonik per (tim, player) dari STRATZ (SUMBER UTAMA, gantiin tebakan net-worth).
 *
 * STRATZ team(teamId).members[].steamAccount.proSteamAccount kasih:
 *   - position: POSITION_1..5 (skala 1-5, sama kayak kita) → map POSITION_n -> n. UNKNOWN/null -> null.
 *   - teamId: tim SEKARANG player → is_active = (teamId == tim ini). beda/null = standin/ex.
 * Simpan SEMUA member (aktif + standin) + name + raw_position (audit). match_players.position TIDAK disentuh.
 *
 * Tim yang di-fetch: cuma yang ADA di matches kita. Refresh: skip kalau updated_at < ROSTER_TTL_DAYS,
 * KECUALI --force (semua) atau --team <id> (satu tim, paksa). --dry-run = fetch + print, tanpa nulis DB.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, STRATZ_TOKEN.
 * Jalan: npm run roster:local [-- --force | --team 9247354 | --dry-run]
 */
import { createDb } from "./core";
import type { SupabaseClient } from "@supabase/supabase-js";

const STRATZ_TOKEN = (process.env.STRATZ_TOKEN ?? "").trim();
const THROTTLE_MS = 1900; // 2000/jam cap → 1.9s aman (sama kayak stratz.ts)
const TTL_DAYS = Number(process.env.ROSTER_TTL_DAYS ?? "3");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;

interface StratzMember {
  steamAccountId: number | null;
  steamAccount: {
    name: string | null;
    proSteamAccount: { name: string | null; position: string | null; teamId: number | null } | null;
  } | null;
}
interface RoleRow {
  team_id: number;
  account_id: number;
  name: string | null;
  position: number | null;
  raw_position: string | null;
  is_active: boolean;
}

// POSITION_n -> n. UNKNOWN / FILTERED / ALL / null -> null (jangan asumsi, cuma terima 1-5).
function mapPosition(raw: string | null): number | null {
  if (!raw) return null;
  const m = /^POSITION_([1-5])$/.exec(raw);
  return m ? Number(m[1]) : null;
}

async function stratzMembers(teamId: number): Promise<StratzMember[]> {
  const query = `query($id: Int!){ team(teamId:$id){ id members{ steamAccountId steamAccount{ name proSteamAccount{ name position teamId } } } } }`;
  let attempt = 0;
  for (;;) {
    const wait = THROTTLE_MS - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();

    let res: Response;
    try {
      res = await fetch("https://api.stratz.com/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${STRATZ_TOKEN}`,
          "User-Agent": "STRATZ_API",
        },
        body: JSON.stringify({ query, variables: { id: teamId } }),
      });
    } catch (e) {
      if (attempt++ < 3) {
        await sleep(1000 * attempt);
        continue;
      }
      throw new Error(`STRATZ team ${teamId} network: ${e instanceof Error ? e.message : e}`);
    }

    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after"));
      const backoff = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 5000 * 2 ** Math.min(attempt, 4);
      if (attempt++ < 6) {
        await sleep(backoff);
        continue;
      }
      throw new Error(`STRATZ team ${teamId} 429 (retry habis)`);
    }
    if (res.status >= 500 && attempt++ < 3) {
      await sleep(1000 * attempt);
      continue;
    }
    if (!res.ok) throw new Error(`STRATZ team ${teamId} -> ${res.status} ${res.statusText}`);

    const json = (await res.json()) as { data?: { team?: { members?: StratzMember[] } | null } };
    return json.data?.team?.members ?? [];
  }
}

function toRows(teamId: number, members: StratzMember[]): RoleRow[] {
  const rows: RoleRow[] = [];
  for (const m of members) {
    if (m.steamAccountId == null) continue;
    const pro = m.steamAccount?.proSteamAccount ?? null;
    const raw = pro?.position ?? null;
    rows.push({
      team_id: teamId,
      account_id: m.steamAccountId,
      name: pro?.name ?? m.steamAccount?.name ?? null,
      position: mapPosition(raw),
      raw_position: raw,
      is_active: !!pro && pro.teamId === teamId,
    });
  }
  return rows;
}

// team_id yang ADA di matches kita (radiant/dire), dedupe.
async function teamIdsInMatches(db: SupabaseClient): Promise<number[]> {
  const set = new Set<number>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("matches")
      .select("radiant_team_id, dire_team_id")
      .range(from, from + PAGE - 1)
      .returns<{ radiant_team_id: number | null; dire_team_id: number | null }[]>();
    if (error) throw new Error(`read matches: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) {
      if (r.radiant_team_id) set.add(r.radiant_team_id);
      if (r.dire_team_id) set.add(r.dire_team_id);
    }
    if (rows.length < PAGE) break;
  }
  return [...set];
}

// true kalau roster tim ini masih fresh (< TTL) → skip fetch.
async function isFresh(db: SupabaseClient, teamId: number): Promise<boolean> {
  const { data } = await db
    .from("team_player_roles")
    .select("updated_at")
    .eq("team_id", teamId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ updated_at: string }>();
  if (!data?.updated_at) return false;
  const ageDays = (Date.now() - new Date(data.updated_at).getTime()) / 86_400_000;
  return ageDays < TTL_DAYS;
}

async function upsertTeam(db: SupabaseClient, teamId: number, rows: RoleRow[]): Promise<void> {
  // mirror: hapus roster lama tim ini dulu (member bisa keluar) → insert fresh. idempotent.
  const del = await db.from("team_player_roles").delete().eq("team_id", teamId);
  if (del.error) throw new Error(`delete roster ${teamId}: ${del.error.message}`);
  if (rows.length === 0) return;
  const ins = await db
    .from("team_player_roles")
    .insert(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })));
  if (ins.error) throw new Error(`insert roster ${teamId}: ${ins.error.message}`);
}

async function main(): Promise<void> {
  if (!STRATZ_TOKEN) throw new Error("Missing env STRATZ_TOKEN");
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");
  const teamFlagIdx = args.indexOf("--team");
  const oneTeam = teamFlagIdx >= 0 ? Number(args[teamFlagIdx + 1]) : null;
  if (teamFlagIdx >= 0 && !Number.isFinite(oneTeam)) throw new Error("--team butuh team_id angka");

  const db = createDb();
  const ids = oneTeam != null ? [oneTeam] : await teamIdsInMatches(db);
  console.log(
    `roster: ${ids.length} team${oneTeam != null ? ` (--team ${oneTeam})` : " (dari matches)"}` +
      `${force ? " [--force]" : ""}${dryRun ? " [--dry-run]" : ""}, TTL=${TTL_DAYS}d`
  );

  let fetched = 0;
  let skipped = 0;
  let failed = 0;
  let activeTotal = 0;
  let memberTotal = 0;

  for (const id of ids) {
    // --team & --force selalu fetch. else skip kalau fresh.
    if (oneTeam == null && !force && !dryRun && (await isFresh(db, id))) {
      skipped++;
      continue;
    }
    try {
      const members = await stratzMembers(id);
      const rows = toRows(id, members);
      const active = rows.filter((r) => r.is_active);
      activeTotal += active.length;
      memberTotal += rows.length;

      if (dryRun) {
        console.log(`\n[dry] team ${id}: ${rows.length} member (${active.length} active)`);
        for (const r of rows.sort((a, b) => Number(b.is_active) - Number(a.is_active) || (a.position ?? 9) - (b.position ?? 9))) {
          console.log(
            `   acct=${String(r.account_id).padEnd(11)} ${String(r.name ?? "?").padEnd(15)} raw=${String(r.raw_position).padEnd(11)} pos=${r.position ?? "-"} ${r.is_active ? "ACTIVE" : "standin"}`
          );
        }
      } else {
        await upsertTeam(db, id, rows);
      }
      fetched++;
      if (!dryRun && fetched % 20 === 0) console.log(`  …${fetched} team fetched`);
    } catch (e) {
      failed++;
      console.error(`  team ${id}: SKIP — ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(
    `\nDone. fetched=${fetched} skipped(fresh)=${skipped} failed=${failed} | members=${memberTotal} active=${activeTotal}${dryRun ? " (DRY-RUN, no DB write)" : ""}`
  );
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
