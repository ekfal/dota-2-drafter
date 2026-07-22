/**
 * STRATZ lane_result backfill (Option B) — per-player lane outcome.
 *
 * Sumber KETIGA (selain OpenDota): STRATZ GraphQL. Ambil lane outcome JADI (won/tie/lost @ ~10min)
 * per PHYSICAL lane (top/mid/bottom, radiant-relative), lalu attach ke tiap player pakai lane
 * AKTUAL STRATZ (SAFE/MID/OFF) + sisi → orient jadi 1=won 0=tie -1=lost dari sisi player itu.
 *
 * JOIN ke row kita: via account_id (steamAccountId) per match; fallback hero_id kalau account_id
 * kosong/mismatch. POSISI KITA READ-ONLY — stratz TIDAK menyentuh match_players.position.
 * Roamer/jungle/unknown → lane_result null (jujur: gak ada lane fisik buat dinilai).
 *
 * Throttle STRATZ TERPISAH dari OpenDota (2000/jam → 1.9s/req). Watermark: stratz_cursor
 * (match_id asc). Idempotent: update lane_result, aman re-run.
 *
 * RESCAN pass (tiap run, habis cursor loop): match di belakang cursor yang SEMUA row-nya
 * lane_result NULL = STRATZ belum punya data waktu itu → re-fetch, newest-first, cap
 * STRATZ_RESCAN_CAP. (NULL per-row roamer/jungle normal, bukan target — cuma match full-NULL.)
 * ponytail: match mati permanen (STRATZ never parse) ikut ke-retry tiap run dalam cap; kalau
 * quota kebuang, tambah kolom retry-count / exclude list.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, STRATZ_TOKEN, STRATZ_BATCH (default 900),
 *      STRATZ_RESCAN_CAP (default 150).
 */
import { createDb, getState, setState } from "./core";
import type { SupabaseClient } from "@supabase/supabase-js";

const STRATZ_TOKEN = (process.env.STRATZ_TOKEN ?? "").trim();
const BATCH = Number(process.env.STRATZ_BATCH ?? "900");
const RESCAN_CAP = Number(process.env.STRATZ_RESCAN_CAP ?? "150");
const CURSOR_KEY = "stratz_cursor";
const THROTTLE_MS = 1900; // 2000/jam cap → 1.9s aman
const PAGE = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;

type LaneOutcome = "TIE" | "RADIANT_VICTORY" | "RADIANT_STOMP" | "DIRE_VICTORY" | "DIRE_STOMP" | null;
interface StratzPlayer {
  heroId: number;
  steamAccountId: number | null;
  isRadiant: boolean;
  lane: string | null; // SAFE_LANE / MID_LANE / OFF_LANE / ROAMING / JUNGLE / UNKNOWN
}
interface StratzMatch {
  id: number;
  topLaneOutcome: LaneOutcome;
  midLaneOutcome: LaneOutcome;
  bottomLaneOutcome: LaneOutcome;
  players: StratzPlayer[];
}

async function stratzMatch(matchId: number): Promise<StratzMatch | null> {
  const query = `query($id: Long!){ match(id:$id){ id topLaneOutcome midLaneOutcome bottomLaneOutcome players{ heroId steamAccountId isRadiant lane } } }`;
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
        body: JSON.stringify({ query, variables: { id: matchId } }),
      });
    } catch (e) {
      if (attempt++ < 3) {
        await sleep(1000 * attempt);
        continue;
      }
      throw new Error(`STRATZ ${matchId} network: ${e instanceof Error ? e.message : e}`);
    }

    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after"));
      const backoff = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 5000 * 2 ** Math.min(attempt, 4);
      if (attempt++ < 6) {
        await sleep(backoff);
        continue;
      }
      throw new Error(`STRATZ ${matchId} 429 (retry habis)`);
    }
    if (res.status >= 500 && attempt++ < 3) {
      await sleep(1000 * attempt);
      continue;
    }
    if (!res.ok) throw new Error(`STRATZ ${matchId} -> ${res.status} ${res.statusText}`);

    const json = (await res.json()) as { data?: { match?: StratzMatch | null }; errors?: unknown };
    return json.data?.match ?? null;
  }
}

// STRATZ lane + sisi → physical lane (top/mid/bottom). Roam/jungle/unknown → null.
function physicalLane(lane: string | null, isRadiant: boolean): "top" | "mid" | "bottom" | null {
  if (lane === "MID_LANE") return "mid";
  if (lane === "SAFE_LANE") return isRadiant ? "bottom" : "top";
  if (lane === "OFF_LANE") return isRadiant ? "top" : "bottom";
  return null; // ROAMING / JUNGLE / UNKNOWN / null
}
function radiantWon(o: LaneOutcome): 1 | 0 | -1 | null {
  if (o === "RADIANT_VICTORY" || o === "RADIANT_STOMP") return 1;
  if (o === "DIRE_VICTORY" || o === "DIRE_STOMP") return -1;
  if (o === "TIE") return 0;
  return null;
}
// lane_result dari sisi player: 1 won, 0 tie, -1 lost, null unknown/no-lane.
function laneResult(m: StratzMatch, p: StratzPlayer): number | null {
  const pl = physicalLane(p.lane, p.isRadiant);
  if (!pl) return null;
  const outcome = pl === "top" ? m.topLaneOutcome : pl === "mid" ? m.midLaneOutcome : m.bottomLaneOutcome;
  const rw = radiantWon(outcome);
  if (rw === null) return null;
  if (rw === 0) return 0;
  const radiantWonLane = rw === 1;
  return radiantWonLane === p.isRadiant ? 1 : -1;
}

interface OurRow {
  match_id: number;
  account_id: number | null;
  hero_id: number;
}

interface Stats {
  matchesProcessed: number;
  matchesWithLane: number;
  matchesNoData: number;
  rowsSet: number;
  nullRows: number;
  won: number;
  tie: number;
  lost: number;
  joinAccount: number;
  joinHeroFallback: number;
  unmatched: number;
}

// update lane_result dengan retry (survive blip network transient ke Supabase)
async function updateLane(db: SupabaseClient, matchId: number, heroId: number, lr: number | null): Promise<void> {
  let attempt = 0;
  for (;;) {
    try {
      const { error } = await db
        .from("match_players")
        .update({ lane_result: lr })
        .eq("match_id", matchId)
        .eq("hero_id", heroId);
      if (error) throw new Error(error.message);
      return;
    } catch (e) {
      if (attempt++ < 4) {
        await sleep(500 * attempt);
        continue;
      }
      throw new Error(`update ${matchId}/${heroId}: ${e instanceof Error ? e.message : e}`);
    }
  }
}

async function processMatch(db: SupabaseClient, matchId: number, ourRows: OurRow[], s: Stats): Promise<void> {
  const m = await stratzMatch(matchId);
  s.matchesProcessed++;
  const hasLane = !!(m && (m.topLaneOutcome || m.midLaneOutcome || m.bottomLaneOutcome));
  if (!m || !hasLane) {
    s.matchesNoData++;
    return;
  }
  s.matchesWithLane++;

  const byAccount = new Map<number, StratzPlayer>();
  const byHero = new Map<number, StratzPlayer>();
  for (const p of m.players) {
    if (p.steamAccountId) byAccount.set(p.steamAccountId, p);
    byHero.set(p.heroId, p);
  }

  for (const row of ourRows) {
    let sp: StratzPlayer | undefined;
    if (row.account_id && byAccount.has(row.account_id)) {
      sp = byAccount.get(row.account_id);
      s.joinAccount++;
    } else if (byHero.has(row.hero_id)) {
      sp = byHero.get(row.hero_id);
      s.joinHeroFallback++;
    }
    if (!sp) {
      s.unmatched++;
      continue;
    }
    const lr = laneResult(m, sp);
    if (lr === null) s.nullRows++;
    else {
      s.rowsSet++;
      if (lr === 1) s.won++;
      else if (lr === 0) s.tie++;
      else s.lost++;
    }
    await updateLane(db, row.match_id, row.hero_id, lr);
  }
}

async function main(): Promise<void> {
  if (!STRATZ_TOKEN) throw new Error("Missing STRATZ_TOKEN");
  const db = createDb();
  let cursor = (await getState(db, CURSOR_KEY)) ?? 0;
  console.log(`STRATZ backfill start. cursor(match_id)=${cursor} batch=${BATCH} throttle=${THROTTLE_MS}ms`);

  const s: Stats = {
    matchesProcessed: 0,
    matchesWithLane: 0,
    matchesNoData: 0,
    rowsSet: 0,
    nullRows: 0,
    won: 0,
    tie: 0,
    lost: 0,
    joinAccount: 0,
    joinHeroFallback: 0,
    unmatched: 0,
  };

  while (s.matchesProcessed < BATCH) {
    const { data: matches, error } = await db
      .from("matches")
      .select("match_id")
      .gt("match_id", cursor)
      .order("match_id", { ascending: true })
      .limit(PAGE)
      .returns<{ match_id: number }[]>();
    if (error) throw new Error(`read matches: ${error.message}`);
    if (!matches || matches.length === 0) {
      console.log("No more matches — backfill complete.");
      break;
    }

    const ids = matches.map((r) => r.match_id);
    // chunk 90 ids (×10 players = 900 rows) < PostgREST 1000-row cap — jangan sampai ke-truncate
    const mpData: OurRow[] = [];
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const { data, error: mpErr } = await db
        .from("match_players")
        .select("match_id, account_id, hero_id")
        .in("match_id", chunk)
        .returns<OurRow[]>();
      if (mpErr) throw new Error(`read match_players: ${mpErr.message}`);
      mpData.push(...(data ?? []));
    }
    const byMatch = new Map<number, OurRow[]>();
    for (const r of mpData) {
      const arr = byMatch.get(r.match_id) ?? [];
      arr.push(r);
      byMatch.set(r.match_id, arr);
    }

    for (const mid of ids) {
      if (s.matchesProcessed >= BATCH) break;
      try {
        await processMatch(db, mid, byMatch.get(mid) ?? [], s);
      } catch (e) {
        console.error(`match ${mid}: FAIL — ${e instanceof Error ? e.message : e}. Stop; cursor tetap → re-run lanjut.`);
        await report(db, s, cursor);
        return;
      }
      cursor = mid;
      await setState(db, CURSOR_KEY, cursor);
      if (s.matchesProcessed % 25 === 0) {
        console.log(`  …${s.matchesProcessed} matches (cursor=${cursor}, withLane=${s.matchesWithLane})`);
      }
    }
  }

  await rescanNulls(db, s, cursor);
  await report(db, s, cursor);
}

// RESCAN: match <= cursor yang SEMUA row match_players-nya lane_result NULL → dulu STRATZ belum
// punya data (matchesNoData) tapi cursor keburu maju. Newest-first (data baru paling mungkin
// nongol), cap RESCAN_CAP. Fail satu match → skip lanjut (bukan stop; cursor gak terlibat).
async function rescanNulls(db: SupabaseClient, s: Stats, cursor: number): Promise<void> {
  if (RESCAN_CAP <= 0) return;
  // match yang PUNYA lane_result → exclude. Paginated (rows > 1000).
  const covered = new Set<number>();
  for (let f = 0; ; f += 1000) {
    const { data, error } = await db
      .from("match_players")
      .select("match_id")
      .not("lane_result", "is", null)
      .order("match_id", { ascending: true })
      .range(f, f + 999)
      .returns<{ match_id: number }[]>();
    if (error) throw new Error(`rescan read covered: ${error.message}`);
    for (const r of data ?? []) covered.add(r.match_id);
    if (!data || data.length < 1000) break;
  }
  const targets: number[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await db
      .from("matches")
      .select("match_id")
      .lte("match_id", cursor)
      .order("match_id", { ascending: false })
      .range(f, f + 999)
      .returns<{ match_id: number }[]>();
    if (error) throw new Error(`rescan read matches: ${error.message}`);
    for (const r of data ?? []) if (!covered.has(r.match_id)) targets.push(r.match_id);
    if (!data || data.length < 1000 || targets.length >= RESCAN_CAP) break;
  }
  const picked = targets.slice(0, RESCAN_CAP);
  console.log(`\nRESCAN: ${targets.length} match full-NULL di belakang cursor, proses ${picked.length} (cap ${RESCAN_CAP})`);
  if (picked.length === 0) return;

  const before = s.rowsSet;
  for (let i = 0; i < picked.length; i += 90) {
    const chunk = picked.slice(i, i + 90);
    const { data, error } = await db
      .from("match_players")
      .select("match_id, account_id, hero_id")
      .in("match_id", chunk)
      .returns<OurRow[]>();
    if (error) throw new Error(`rescan read match_players: ${error.message}`);
    const byMatch = new Map<number, OurRow[]>();
    for (const r of data ?? []) {
      const arr = byMatch.get(r.match_id) ?? [];
      arr.push(r);
      byMatch.set(r.match_id, arr);
    }
    for (const mid of chunk) {
      try {
        await processMatch(db, mid, byMatch.get(mid) ?? [], s);
      } catch (e) {
        console.error(`  rescan ${mid}: FAIL — ${e instanceof Error ? e.message : e}. Skip.`);
      }
    }
  }
  console.log(`RESCAN done: rows kesisi run ini dari rescan=${s.rowsSet - before}`);
}

async function report(db: SupabaseClient, s: Stats, cursor: number): Promise<void> {
  // total lane_result terisi di DB (bukan cuma run ini)
  const nonNull = await db.from("match_players").select("*", { count: "exact", head: true }).not("lane_result", "is", null);
  console.log("\n=== STRATZ BACKFILL REPORT (this run) ===");
  console.log(`cursor(match_id)=${cursor}`);
  console.log(`matches processed=${s.matchesProcessed} | with lane data=${s.matchesWithLane} | no data=${s.matchesNoData}`);
  console.log(`rows lane_result set=${s.rowsSet} | null (roamer/no-lane)=${s.nullRows} | unmatched=${s.unmatched}`);
  console.log(`  won=${s.won} tie=${s.tie} lost=${s.lost}`);
  console.log(`join: account_id=${s.joinAccount} | hero_id fallback=${s.joinHeroFallback}`);
  console.log(`DB total match_players with lane_result (all runs)=${nonNull.count ?? "?"}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
