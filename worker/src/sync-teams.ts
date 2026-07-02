/**
 * sync-teams — isi teams.logo_url (+ tag, rating) dari /teams/{id} buat tiap team yg logo-nya null.
 * Terpisah dari ingest/aggregate (beda cadence, beda endpoint). Throttle via core.opendota.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENDOTA_API_KEY (opsional).
 */
import { createDb, opendota } from "./core";

interface TeamDetail {
  team_id: number;
  name: string | null;
  tag: string | null;
  rating: number | null;
  logo_url: string | null;
}

async function main(): Promise<void> {
  const db = createDb();

  const { data, error } = await db
    .from("teams")
    .select("team_id")
    .is("logo_url", null)
    .returns<{ team_id: number }[]>();
  if (error) throw new Error(`read teams: ${error.message}`);
  const ids = (data ?? []).map((t) => t.team_id);
  console.log(`Teams tanpa logo_url = ${ids.length}`);

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

  console.log(`Done. updated=${updated} withLogo=${withLogo} failed=${failed}.`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
