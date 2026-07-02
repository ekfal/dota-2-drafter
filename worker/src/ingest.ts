/**
 * Ingest worker (forward) — poll /proMatches, proses match BARU via watermark.
 * Logika per-match di core.ts (dipakai bareng backfill.ts).
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENDOTA_API_KEY (opsional),
 *      INGEST_MAX_MATCHES (batas match baru per run).
 */
import { createDb, opendota, seedHeroes, ingestMatch, getState, setState, type ProMatch } from "./core";

const MAX_MATCHES = Number(process.env.INGEST_MAX_MATCHES ?? "25");
const WATERMARK_KEY = "last_promatch_id";

async function main(): Promise<void> {
  const db = createDb();
  await seedHeroes(db);

  const watermark = await getState(db, WATERMARK_KEY);
  console.log(`watermark last_promatch_id = ${watermark ?? "(none, first run)"}`);

  const feed = await opendota<ProMatch[]>("/proMatches");
  const fresh = feed
    .filter((m) => watermark === null || m.match_id > watermark)
    .sort((a, b) => a.match_id - b.match_id)
    .slice(0, MAX_MATCHES);

  if (fresh.length === 0) {
    console.log("Tak ada match baru. Selesai.");
    return;
  }
  console.log(`Proses ${fresh.length} match baru (limit ${MAX_MATCHES}).`);

  // Watermark cuma maju di prefix sukses KONTIGU (urut naik). Match gagal di-retry run berikut.
  let watermarkAdvance = watermark ?? 0;
  let chainOk = true;
  let ingested = 0;
  let noDraft = 0;
  let failed = 0;

  for (const m of fresh) {
    try {
      const status = await ingestMatch(db, m);
      if (status === "ingested") ingested++;
      else noDraft++;
      if (chainOk) watermarkAdvance = m.match_id;
    } catch (e) {
      failed++;
      chainOk = false;
      console.error(`  match ${m.match_id}: SKIP — ${e instanceof Error ? e.message : e}`);
    }
  }

  if (watermarkAdvance > (watermark ?? 0)) await setState(db, WATERMARK_KEY, watermarkAdvance);
  console.log(`Done. ingested=${ingested} no-draft=${noDraft} failed=${failed}. watermark -> ${watermarkAdvance}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
