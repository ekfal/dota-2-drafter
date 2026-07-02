/**
 * Core ingest — dipakai bareng oleh ingest.ts (forward watermark) & backfill.ts (backward cursor).
 *
 * HANYA worker sentuh OpenDota (CLAUDE.md §3). Slim: tak simpan telemetry (cuma net_worth 1 int).
 * ingestMatch idempotent (delete+insert mirror) → aman re-process.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENDOTA_API_KEY (opsional).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { derivePositions } from "./positions";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

// Anggap TIDAK ADA key kalau kosong atau "none" (case-insensitive) — jangan tempel ?api_key.
const rawKey = (process.env.OPENDOTA_API_KEY ?? "").trim();
const OPENDOTA_API_KEY = rawKey.toLowerCase() === "none" ? "" : rawKey;
// Throttle dasar: tanpa key pelan (1.3s ≈ 46/min) biar jarang kena 429; dgn key longgar.
const THROTTLE_MS = OPENDOTA_API_KEY ? 350 : 1300;
const RETRIES_5XX = 2; // 5xx/network: retry cepat (transient server)
const RETRIES_429 = 4; // 429: retry lama (kita kecepetan) — backoff naik

export function createDb(): SupabaseClient {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_KEY"), {
    auth: { persistSession: false },
  });
}

// ---------- OpenDota shapes (slim) ----------
export interface ProMatch {
  match_id: number;
  duration: number | null;
  start_time: number | null;
  radiant_team_id: number | null;
  radiant_name: string | null;
  dire_team_id: number | null;
  dire_name: string | null;
  leagueid: number | null;
  league_name: string | null;
  radiant_win: boolean | null;
}
interface PickBan {
  is_pick: boolean;
  hero_id: number;
  team: number;
  order: number;
}
interface MatchPlayer {
  account_id: number | null;
  player_slot: number;
  hero_id: number;
  isRadiant: boolean;
  win: number;
  lane_role: number | null;
  net_worth: number | null;
  name: string | null;
  personaname: string | null;
}
interface MatchDetail {
  match_id: number;
  picks_bans: PickBan[] | null;
  players: MatchPlayer[] | null;
}
interface HeroConst {
  id: number;
  localized_name: string;
  primary_attr: string;
  img: string;
}

export type IngestStatus = "ingested" | "no-draft";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------- throttled OpenDota fetch ----------
// 429 (rate-limit) beda dari 5xx: backoff LEBIH PANJANG (2s,4s,8s,16s), hormati Retry-After.
// 5xx/network: retry cepat (transient). 4xx lain: nyerah langsung.
let lastCall = 0;
export async function opendota<T>(path: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `https://api.opendota.com/api${path}${OPENDOTA_API_KEY ? `${sep}api_key=${OPENDOTA_API_KEY}` : ""}`;

  let n5xx = 0;
  let n429 = 0;
  for (;;) {
    const wait = THROTTLE_MS - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();

    let res: Response;
    try {
      res = await fetch(url);
    } catch (e) {
      if (n5xx++ < RETRIES_5XX) {
        await sleep(500 * n5xx);
        continue;
      }
      throw new Error(`OpenDota ${path} -> network: ${e instanceof Error ? e.message : e}`);
    }

    if (res.ok) return (await res.json()) as T;

    if (res.status === 429) {
      if (n429++ < RETRIES_429) {
        const ra = Number(res.headers.get("retry-after")); // detik (kalau ada)
        const backoff = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 2000 * 2 ** (n429 - 1); // 2s,4s,8s,16s
        await sleep(backoff);
        continue;
      }
      throw new Error(`OpenDota ${path} -> 429 Too Many Requests (retry habis)`);
    }

    if (res.status >= 500 && n5xx++ < RETRIES_5XX) {
      await sleep(500 * n5xx);
      continue;
    }
    throw new Error(`OpenDota ${path} -> ${res.status} ${res.statusText}`);
  }
}

// ---------- heroes seed ----------
export async function seedHeroes(db: SupabaseClient): Promise<void> {
  const heroes = await opendota<HeroConst[]>("/heroStats");
  const rows = heroes.map((h) => ({
    hero_id: h.id,
    localized_name: h.localized_name,
    primary_attr: h.primary_attr,
    img: h.img,
  }));
  const { error } = await db.from("heroes").upsert(rows, { onConflict: "hero_id" });
  if (error) throw new Error(`upsert heroes: ${error.message}`);
  console.log(`Seeded ${rows.length} heroes (with img).`);
}

// ---------- per-match ingest (idempotent) ----------
export async function ingestMatch(db: SupabaseClient, m: ProMatch): Promise<IngestStatus> {
  const detail = await opendota<MatchDetail>(`/matches/${m.match_id}`);
  if (!detail.picks_bans || detail.picks_bans.length === 0) {
    console.log(`  match ${m.match_id}: tak ada picks_bans (non-CM), skip.`);
    return "no-draft";
  }

  if (m.leagueid && m.leagueid > 0) {
    const { error } = await db
      .from("leagues")
      .upsert({ league_id: m.leagueid, name: m.league_name }, { onConflict: "league_id" });
    if (error) throw new Error(`upsert league ${m.leagueid}: ${error.message}`);
  }
  await upsertTeam(db, m.radiant_team_id, m.radiant_name);
  await upsertTeam(db, m.dire_team_id, m.dire_name);

  const { error: mErr } = await db.from("matches").upsert(
    {
      match_id: m.match_id,
      league_id: m.leagueid && m.leagueid > 0 ? m.leagueid : null,
      patch_id: null,
      radiant_team_id: m.radiant_team_id || null,
      dire_team_id: m.dire_team_id || null,
      radiant_win: m.radiant_win,
      start_time: m.start_time,
      duration: m.duration,
    },
    { onConflict: "match_id" }
  );
  if (mErr) throw new Error(`upsert match ${m.match_id}: ${mErr.message}`);

  const { error: delErr } = await db.from("picks_bans").delete().eq("match_id", m.match_id);
  if (delErr) throw new Error(`delete picks_bans ${m.match_id}: ${delErr.message}`);
  const pbRows = detail.picks_bans.map((pb) => ({
    match_id: m.match_id,
    ord: pb.order,
    is_pick: pb.is_pick,
    hero_id: pb.hero_id,
    team: pb.team,
  }));
  const { error: pbErr } = await db.from("picks_bans").insert(pbRows);
  if (pbErr) throw new Error(`insert picks_bans ${m.match_id}: ${pbErr.message}`);

  const mpCount = await ingestMatchPlayers(db, m.match_id, detail.players ?? []);
  console.log(`  match ${m.match_id}: ${pbRows.length} pb, ${mpCount} players.`);
  return "ingested";
}

async function ingestMatchPlayers(
  db: SupabaseClient,
  matchId: number,
  players: MatchPlayer[]
): Promise<number> {
  const valid = players.filter((p) => p.hero_id && p.hero_id > 0);
  if (valid.length === 0) return 0;

  const playerRows = valid
    .filter((p) => p.account_id)
    .map((p) => ({ account_id: p.account_id, name: p.name ?? p.personaname ?? null }));
  if (playerRows.length > 0) {
    const { error } = await db.from("players").upsert(playerRows, { onConflict: "account_id" });
    if (error) throw new Error(`upsert players ${matchId}: ${error.message}`);
  }

  const posBySlot = new Map<number, number>();
  for (const side of [valid.filter((p) => p.isRadiant), valid.filter((p) => !p.isRadiant)]) {
    const dp = derivePositions(
      side.map((p) => ({ player_slot: p.player_slot, net_worth: p.net_worth, lane_role: p.lane_role }))
    );
    dp.forEach((v, k) => posBySlot.set(k, v));
  }

  const rows = valid.map((p) => ({
    match_id: matchId,
    account_id: p.account_id ?? null,
    hero_id: p.hero_id,
    is_radiant: p.isRadiant,
    win: p.win === 1 ? true : p.win === 0 ? false : null,
    lane_role: p.lane_role ?? null,
    player_slot: p.player_slot,
    net_worth: p.net_worth ?? null,
    position: posBySlot.get(p.player_slot) ?? null,
  }));

  const { error: delErr } = await db.from("match_players").delete().eq("match_id", matchId);
  if (delErr) throw new Error(`delete match_players ${matchId}: ${delErr.message}`);
  const { error: insErr } = await db.from("match_players").insert(rows);
  if (insErr) throw new Error(`insert match_players ${matchId}: ${insErr.message}`);
  return rows.length;
}

async function upsertTeam(db: SupabaseClient, teamId: number | null, name: string | null): Promise<void> {
  if (!teamId || teamId <= 0) return;
  const { error } = await db.from("teams").upsert({ team_id: teamId, name }, { onConflict: "team_id" });
  if (error) throw new Error(`upsert team ${teamId}: ${error.message}`);
}

// ---------- ingest_state (watermark / cursor) ----------
export async function getState(db: SupabaseClient, key: string): Promise<number | null> {
  const { data, error } = await db.from("ingest_state").select("value").eq("key", key).maybeSingle();
  if (error) throw new Error(`read state ${key}: ${error.message}`);
  return data ? Number(data.value) : null;
}
export async function setState(db: SupabaseClient, key: string, value: number): Promise<void> {
  const { error } = await db.from("ingest_state").upsert(
    { key, value: String(value), updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (error) throw new Error(`write state ${key}: ${error.message}`);
}
