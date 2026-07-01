/**
 * Aggregate job (FR-1) — rebuild tournament_hero_stats dari picks_bans (tabel mentah).
 *
 * Tabel hitungan = derived, rebuildable. Job ini TERPISAH dari ingest (jalanin lebih jarang,
 * mis. harian) biar murah. Full rebuild: hapus semua baris lalu recompute per league × hero.
 *
 * contest = picks + bans (per match hero cuma bisa pick ATAU ban → tak overlap).
 * Agregasi di Node (JS), bukan SQL — no DDL/objek DB baru (keputusan pola: lihat FR-1).
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
  match: { league_id: number | null } | null;
}
interface StatRow {
  league_id: number;
  hero_id: number;
  picks: number;
  bans: number;
  contest: number;
}

async function main(): Promise<void> {
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // 1. Tarik semua picks_bans + league_id (paginate).
  const acc = new Map<string, { league_id: number; hero_id: number; picks: number; bans: number }>();
  let from = 0;
  let total = 0;
  for (;;) {
    const { data, error } = await db
      .from("picks_bans")
      .select("hero_id, is_pick, match:matches!picks_bans_match_id_fkey(league_id)")
      .range(from, from + PAGE - 1)
      .returns<PbRow[]>();
    if (error) throw new Error(`read picks_bans: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const r of data) {
      const league = r.match?.league_id;
      if (!league) continue; // skip match tanpa league
      const key = `${league}::${r.hero_id}`;
      const cur = acc.get(key) ?? { league_id: league, hero_id: r.hero_id, picks: 0, bans: 0 };
      if (r.is_pick) cur.picks++;
      else cur.bans++;
      acc.set(key, cur);
    }
    total += data.length;
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`Scanned ${total} picks_bans rows -> ${acc.size} (league,hero) pairs.`);

  const rows: StatRow[] = [...acc.values()].map((v) => ({
    league_id: v.league_id,
    hero_id: v.hero_id,
    picks: v.picks,
    bans: v.bans,
    contest: v.picks + v.bans,
  }));

  // 2. Full rebuild: hapus semua lalu insert.
  const { error: delErr } = await db.from("tournament_hero_stats").delete().gte("league_id", 0);
  if (delErr) throw new Error(`delete tournament_hero_stats: ${delErr.message}`);

  await insertBatched(db, rows);
  console.log(`Done. tournament_hero_stats rebuilt: ${rows.length} rows.`);
}

async function insertBatched(db: SupabaseClient, rows: StatRow[]): Promise<void> {
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await db.from("tournament_hero_stats").insert(chunk);
    if (error) throw new Error(`insert tournament_hero_stats @${i}: ${error.message}`);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
