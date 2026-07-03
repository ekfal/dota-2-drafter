/**
 * Patches — seed tabel `patches` dari dotaconstants + backfill `matches.patch_id`.
 *
 * patch_id per-match = patch terakhir yang start_time-nya <= match.start_time (CLAUDE.md §5:
 * patch_id per match, bukan per turnamen). Idempotent: re-run aman (upsert + set ulang).
 * Ingest baru sudah nge-tag patch_id sendiri (core.ts); script ini buat seed awal + nambal lama.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENDOTA_API_KEY (opsional).
 */
import { createDb, seedPatches, pickPatchId, type PatchRow } from "./core";

const PAGE = 1000; // ambil match per halaman (batas PostgREST)

async function main(): Promise<void> {
  const db = createDb();

  // 1) seed patches
  await seedPatches(db);

  // 2) patches urut naik (buat resolver)
  const { data: patches, error: pErr } = await db
    .from("patches")
    .select("id, start_time")
    .order("start_time", { ascending: true })
    .returns<PatchRow[]>();
  if (pErr) throw new Error(`read patches: ${pErr.message}`);
  const list = patches ?? [];
  if (list.length === 0) throw new Error("patches kosong setelah seed — abort.");

  // 3) backfill matches.patch_id — semua match (idempotent), paginasi by match_id
  let after = 0;
  let scanned = 0;
  let updated = 0;
  let skippedNoTime = 0;
  for (;;) {
    const { data: rows, error } = await db
      .from("matches")
      .select("match_id, start_time, patch_id")
      .gt("match_id", after)
      .order("match_id", { ascending: true })
      .limit(PAGE)
      .returns<{ match_id: number; start_time: number | null; patch_id: number | null }[]>();
    if (error) throw new Error(`read matches: ${error.message}`);
    if (!rows || rows.length === 0) break;

    for (const m of rows) {
      after = m.match_id;
      scanned++;
      const pid = pickPatchId(list, m.start_time);
      if (pid === null) {
        if (!m.start_time) skippedNoTime++;
        continue;
      }
      if (m.patch_id === pid) continue; // sudah benar
      const { error: uErr } = await db.from("matches").update({ patch_id: pid }).eq("match_id", m.match_id);
      if (uErr) throw new Error(`update match ${m.match_id}: ${uErr.message}`);
      updated++;
    }
    if (rows.length < PAGE) break;
  }

  console.log(
    `PATCH BACKFILL DONE. patches=${list.length} scanned=${scanned} updated=${updated} skipped(no start_time)=${skippedNoTime}`
  );
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
