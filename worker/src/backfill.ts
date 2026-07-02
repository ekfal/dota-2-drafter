/**
 * Backfill (backward) — dari match_id tertinggi TURUN via /proMatches?less_than_match_id.
 * Re-process semua (idempotent) → nambal match_players yang bolong di match lama + nambah history
 * sampai BACKFILL_TARGET total match.
 *
 * Cicil: max BACKFILL_BATCH match per run. Cursor (backfill_cursor) disimpan tiap match →
 * interrupt-safe, lanjut dari terakhir (bukan dari nol).
 *
 * Env: + BACKFILL_TARGET (default 800), BACKFILL_BATCH (default 100).
 */
import { createDb, opendota, seedHeroes, ingestMatch, getState, setState, type ProMatch } from "./core";

const TARGET = Number(process.env.BACKFILL_TARGET ?? "800");
const BATCH = Number(process.env.BACKFILL_BATCH ?? "100");
const CURSOR_KEY = "backfill_cursor";

async function matchCount(db: ReturnType<typeof createDb>): Promise<number> {
  const { count, error } = await db.from("matches").select("*", { count: "exact", head: true });
  if (error) throw new Error(`count matches: ${error.message}`);
  return count ?? 0;
}

async function main(): Promise<void> {
  const db = createDb();
  await seedHeroes(db);

  let dbCount = await matchCount(db);
  console.log(`DB matches = ${dbCount}, target = ${TARGET}, batch = ${BATCH}`);
  if (dbCount >= TARGET) {
    console.log("REACHED TARGET — tak ada backfill.");
    return;
  }

  let cursor = await getState(db, CURSOR_KEY);
  console.log(`backfill_cursor = ${cursor ?? "(none, mulai dari newest)"}`);

  let processed = 0;
  let ingested = 0;
  let noDraft = 0;
  let failed = 0;
  let stop = false;

  // Cursor cuma maju pada SUKSES (ingested / non-CM = sengaja skip). Fetch-error (429 setelah
  // retry / network) → BERHENTI run, cursor tetap di sukses terakhir → match gagal di-retry run
  // berikut (bukan dilewatin permanen). Beda dari non-CM yang memang di-skip.
  while (!stop && processed < BATCH && dbCount < TARGET) {
    const path = cursor ? `/proMatches?less_than_match_id=${cursor}` : "/proMatches";
    const feed = await opendota<ProMatch[]>(path);
    if (feed.length === 0) {
      console.log("FEED EMPTY — history habis.");
      break;
    }

    for (const m of feed) {
      if (processed >= BATCH || dbCount >= TARGET) {
        stop = true;
        break;
      }
      try {
        const status = await ingestMatch(db, m);
        if (status === "ingested") ingested++;
        else noDraft++;
        processed++;
        cursor = m.match_id; // maju hanya setelah sukses (turun)
        await setState(db, CURSOR_KEY, cursor);
        if (processed % 25 === 0) dbCount = await matchCount(db);
      } catch (e) {
        failed++;
        console.error(`  match ${m.match_id}: FAIL — ${e instanceof Error ? e.message : e}`);
        console.log("Stop run; cursor tetap di sukses terakhir → re-run buat lanjut match ini.");
        stop = true;
        break;
      }
    }
  }

  dbCount = await matchCount(db);
  const status = dbCount >= TARGET ? "REACHED TARGET" : "BATCH DONE";
  console.log(
    `${status}. processed=${processed} ingested=${ingested} no-draft=${noDraft} failed=${failed}. cursor=${cursor} dbMatches=${dbCount}`
  );
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
