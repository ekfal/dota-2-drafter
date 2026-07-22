/**
 * sync-teams — teams.rating (Elo) + logo_url dari OpenDota.
 *
 * PASS 1 (bulk): /teams paginated (1000/tim/halaman, urut rating desc) → rating buat SEMUA tim
 * kita. Jauh lebih hemat dari /teams/{id} satu-satu. Alias-aware: rating bisa nyangkut di id
 * ALIAS (mis. PARIVISION main di id lama versi OpenDota) → kandidat = row canonical + row semua
 * alias-nya, pilih last_match_time TERBARU (Elo paling fresh). wins/losses OpenDota di-skip:
 * tabel teams gak punya kolomnya, UI hitung W-L dari matches.
 *
 * PASS 2 (per-id, existing): /teams/{id} buat tim yang logo_url masih null setelah pass 1.
 *
 * Idempotent. Cron: piggyback roster.yml (harian). Run: npm run sync-teams[:local].
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENDOTA_API_KEY (opsional).
 */
import { createDb, opendota } from "./core";

const MAX_PAGES = 30; // 30k tim — tim kecil kita kesebar dalem; stop early kalau semua ketemu

interface TeamListRow {
  team_id: number;
  rating: number | null;
  last_match_time: number | null;
  name: string | null;
  tag: string | null;
  logo_url: string | null;
}
interface TeamDetail {
  team_id: number;
  name: string | null;
  tag: string | null;
  rating: number | null;
  logo_url: string | null;
}

async function main(): Promise<void> {
  const db = createDb();

  const { data: ours, error } = await db
    .from("teams")
    .select("team_id, rating, logo_url")
    .returns<{ team_id: number; rating: number | null; logo_url: string | null }[]>();
  if (error) throw new Error(`read teams: ${error.message}`);
  const { data: aliasRows, error: aErr } = await db
    .from("team_aliases")
    .select("alias_team_id, canonical_team_id")
    .returns<{ alias_team_id: number; canonical_team_id: number }[]>();
  if (aErr) throw new Error(`read team_aliases: ${aErr.message}`);
  const aliasesOf = new Map<number, number[]>(); // canonical -> alias ids
  for (const a of aliasRows ?? []) {
    const arr = aliasesOf.get(a.canonical_team_id) ?? [];
    arr.push(a.alias_team_id);
    aliasesOf.set(a.canonical_team_id, arr);
  }
  const aliasIds = new Set((aliasRows ?? []).map((a) => a.alias_team_id));

  // target = semua id kita + alias (rating bisa nyangkut di alias)
  const targets = new Set<number>();
  for (const t of ours ?? []) targets.add(t.team_id);
  for (const a of aliasIds) targets.add(a);

  // PASS 1: bulk /teams paginated
  const found = new Map<number, TeamListRow>();
  let pages = 0;
  for (let p = 0; p < MAX_PAGES; p++) {
    const rows = await opendota<TeamListRow[]>(`/teams?page=${p}`);
    pages++;
    if (!rows || rows.length === 0) break;
    for (const r of rows) if (targets.has(r.team_id)) found.set(r.team_id, r);
    if (found.size === targets.size) break;
  }
  console.log(`Bulk /teams: ${pages} halaman, ketemu ${found.size}/${targets.size} target id.`);

  let ratingSet = 0;
  let fromAlias = 0;
  for (const t of ours ?? []) {
    if (aliasIds.has(t.team_id)) continue; // baris alias di tabel teams gak usah di-rating (UI gak pakai)
    // kandidat: row id sendiri + row alias-nya → last_match_time terbaru (Elo paling fresh)
    const cands: TeamListRow[] = [];
    const own = found.get(t.team_id);
    if (own) cands.push(own);
    for (const a of aliasesOf.get(t.team_id) ?? []) {
      const r = found.get(a);
      if (r) cands.push(r);
    }
    const best = cands
      .filter((c) => c.rating != null)
      .sort((x, y) => (y.last_match_time ?? 0) - (x.last_match_time ?? 0))[0];
    if (!best) continue;
    const patch: { rating: number | null; logo_url?: string } = { rating: best.rating };
    if (!t.logo_url && best.logo_url) patch.logo_url = best.logo_url;
    if (t.rating === best.rating && !patch.logo_url) continue; // sudah sama
    const { error: uErr } = await db.from("teams").update(patch).eq("team_id", t.team_id);
    if (uErr) throw new Error(`update team ${t.team_id}: ${uErr.message}`);
    ratingSet++;
    if (best.team_id !== t.team_id) fromAlias++;
  }
  console.log(`PASS 1 rating: updated=${ratingSet} (via alias=${fromAlias})`);

  // PASS 2: per-id logo buat yang masih null
  const { data: noLogo, error: lErr } = await db
    .from("teams")
    .select("team_id")
    .is("logo_url", null)
    .returns<{ team_id: number }[]>();
  if (lErr) throw new Error(`read teams no-logo: ${lErr.message}`);
  const ids = (noLogo ?? []).map((t) => t.team_id).filter((id) => !aliasIds.has(id));
  console.log(`PASS 2: teams tanpa logo_url = ${ids.length}`);
  let withLogo = 0;
  let updated = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      const t = await opendota<TeamDetail>(`/teams/${id}`);
      const { error: upErr } = await db
        .from("teams")
        .update({ name: t.name, tag: t.tag, rating: t.rating, logo_url: t.logo_url })
        .eq("team_id", id);
      if (upErr) throw new Error(upErr.message);
      updated++;
      if (t.logo_url) withLogo++;
    } catch (e) {
      failed++;
      console.error(`  team ${id}: SKIP — ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`PASS 2 done. updated=${updated} withLogo=${withLogo} failed=${failed}.`);

  // report null rating sisa (exclude alias)
  const { data: nullRating } = await db
    .from("teams")
    .select("team_id")
    .is("rating", null)
    .returns<{ team_id: number }[]>();
  const sisaNull = (nullRating ?? []).filter((t) => !aliasIds.has(t.team_id)).length;
  console.log(`Sisa rating NULL (exclude alias) = ${sisaNull}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
