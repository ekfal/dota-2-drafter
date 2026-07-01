/**
 * Aggregate job (FR-1 + FR-2) — rebuild tabel hitungan dari picks_bans (tabel mentah).
 *
 * Derived, rebuildable. TERPISAH dari ingest (jalan harian, murah). Satu pass scan picks_bans:
 *   - tournament_hero_stats (per league × hero): picks, bans, contest = picks + bans.
 *   - team_hero_stats (per team × hero, patch_id=null all-patch): picks, pick_wins, bans.
 *
 * Ban→team: picks_bans.team (0=radiant/1=dire) di-map ke team_id via matches.radiant/dire_team_id.
 * Win pick: team==0 && radiant_win, atau team==1 && !radiant_win.
 * Agregasi di Node (JS), bukan SQL — no DDL/objek DB baru (keputusan pola FR-1).
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = requireEnv("SUPABASE_SERVICE_KEY");
const PAGE = 1000; // batas default PostgREST

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

interface PbRow {
  hero_id: number;
  is_pick: boolean;
  team: number; // 0 radiant, 1 dire
  match: {
    league_id: number | null;
    radiant_team_id: number | null;
    dire_team_id: number | null;
    radiant_win: boolean | null;
  } | null;
}
interface TournamentStat {
  league_id: number;
  hero_id: number;
  picks: number;
  bans: number;
  contest: number;
}
interface TeamStat {
  team_id: number;
  hero_id: number;
  patch_id: null;
  picks: number;
  pick_wins: number;
  bans: number;
}

async function main(): Promise<void> {
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const leagueAcc = new Map<string, { league_id: number; hero_id: number; picks: number; bans: number }>();
  const teamAcc = new Map<
    string,
    { team_id: number; hero_id: number; picks: number; pick_wins: number; bans: number }
  >();

  // 1. Scan semua picks_bans + match (paginate).
  let from = 0;
  let total = 0;
  for (;;) {
    const { data, error } = await db
      .from("picks_bans")
      .select(
        "hero_id, is_pick, team, match:matches!picks_bans_match_id_fkey(league_id, radiant_team_id, dire_team_id, radiant_win)"
      )
      .range(from, from + PAGE - 1)
      .returns<PbRow[]>();
    if (error) throw new Error(`read picks_bans: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const r of data) {
      const m = r.match;
      if (!m) continue;

      // FR-1: agregat league
      if (m.league_id) {
        const lk = `${m.league_id}::${r.hero_id}`;
        const lc = leagueAcc.get(lk) ?? { league_id: m.league_id, hero_id: r.hero_id, picks: 0, bans: 0 };
        if (r.is_pick) lc.picks++;
        else lc.bans++;
        leagueAcc.set(lk, lc);
      }

      // FR-2: agregat team (map sisi → team_id)
      const teamId = r.team === 0 ? m.radiant_team_id : m.dire_team_id;
      if (teamId) {
        const tk = `${teamId}::${r.hero_id}`;
        const tc = teamAcc.get(tk) ?? { team_id: teamId, hero_id: r.hero_id, picks: 0, pick_wins: 0, bans: 0 };
        if (r.is_pick) {
          tc.picks++;
          const won = m.radiant_win !== null && ((r.team === 0 && m.radiant_win) || (r.team === 1 && !m.radiant_win));
          if (won) tc.pick_wins++;
        } else {
          tc.bans++;
        }
        teamAcc.set(tk, tc);
      }
    }
    total += data.length;
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(
    `Scanned ${total} picks_bans -> ${leagueAcc.size} (league,hero), ${teamAcc.size} (team,hero) pairs.`
  );

  const tournamentRows: TournamentStat[] = [...leagueAcc.values()].map((v) => ({
    league_id: v.league_id,
    hero_id: v.hero_id,
    picks: v.picks,
    bans: v.bans,
    contest: v.picks + v.bans,
  }));
  const teamRows: TeamStat[] = [...teamAcc.values()].map((v) => ({
    team_id: v.team_id,
    hero_id: v.hero_id,
    patch_id: null,
    picks: v.picks,
    pick_wins: v.pick_wins,
    bans: v.bans,
  }));

  // 2. Full rebuild kedua tabel.
  await rebuild(db, "tournament_hero_stats", "league_id", tournamentRows);
  await rebuild(db, "team_hero_stats", "team_id", teamRows);
  console.log(`Done. tournament_hero_stats=${tournamentRows.length}, team_hero_stats=${teamRows.length}.`);
}

async function rebuild<T extends object>(
  db: SupabaseClient,
  table: string,
  filterCol: string,
  rows: T[]
): Promise<void> {
  const { error: delErr } = await db.from(table).delete().gte(filterCol, 0);
  if (delErr) throw new Error(`delete ${table}: ${delErr.message}`);
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await db.from(table).insert(rows.slice(i, i + BATCH));
    if (error) throw new Error(`insert ${table} @${i}: ${error.message}`);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
