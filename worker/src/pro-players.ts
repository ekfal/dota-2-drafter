/**
 * players.team_id + is_pro backfill dari OpenDota /proPlayers (bulk — 1 request, semua pro).
 *
 * Update HANYA account_id yang sudah ada di tabel players (players = pemain yang pernah muncul
 * di match kita; roster superset ada di team_player_roles). Tidak insert player baru.
 *
 * ASUMSI: masuk list /proPlayers = notable/pro versi OpenDota → is_pro di-set true untuk semua
 * yang match (field is_pro mentah OpenDota spotty: ~476/5035 true, sisanya null — tak dipakai).
 * team_id: di-map lewat team_aliases (alias → canonical) + FK-guard (cuma set kalau team ada
 * di tabel teams kita; team asing → null biar gak melanggar FK).
 *
 * Idempotent: set ulang nilai sama = no-op. Run: npm run pro-players[:local].
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENDOTA_API_KEY (opsional).
 */
import { createDb, opendota } from "./core";

interface ProPlayer {
  account_id: number;
  name: string | null;
  team_id: number | null;
  is_pro: boolean | null;
}

async function main(): Promise<void> {
  const db = createDb();

  const pros = await opendota<ProPlayer[]>("/proPlayers");
  const proByAccount = new Map<number, ProPlayer>();
  for (const p of pros) if (p.account_id) proByAccount.set(p.account_id, p);
  console.log(`OpenDota /proPlayers: ${pros.length} rows.`);

  // alias → canonical + FK guard (teams yang kita kenal)
  const { data: aliasRows, error: aErr } = await db
    .from("team_aliases")
    .select("alias_team_id, canonical_team_id")
    .returns<{ alias_team_id: number; canonical_team_id: number }[]>();
  if (aErr) throw new Error(`read team_aliases: ${aErr.message}`);
  const canonOf = new Map((aliasRows ?? []).map((a) => [a.alias_team_id, a.canonical_team_id]));
  const knownTeams = new Set<number>();
  for (let f = 0; ; f += 1000) {
    const { data, error } = await db.from("teams").select("team_id").range(f, f + 999).returns<{ team_id: number }[]>();
    if (error) throw new Error(`read teams: ${error.message}`);
    for (const t of data ?? []) knownTeams.add(t.team_id);
    if (!data || data.length < 1000) break;
  }

  let scanned = 0;
  let matched = 0;
  let teamSet = 0;
  let teamForeign = 0; // pro punya team, tapi team-nya gak ada di DB kita → team_id null
  let proSet = 0;
  for (let f = 0; ; f += 1000) {
    const { data: rows, error } = await db
      .from("players")
      .select("account_id, team_id, is_pro")
      .order("account_id", { ascending: true })
      .range(f, f + 999)
      .returns<{ account_id: number; team_id: number | null; is_pro: boolean | null }[]>();
    if (error) throw new Error(`read players: ${error.message}`);
    for (const row of rows ?? []) {
      scanned++;
      const pro = proByAccount.get(row.account_id);
      if (!pro) continue;
      matched++;
      const rawTeam = pro.team_id && pro.team_id > 0 ? canonOf.get(pro.team_id) ?? pro.team_id : null;
      const team_id = rawTeam && knownTeams.has(rawTeam) ? rawTeam : null;
      if (rawTeam && !team_id) teamForeign++;
      if (row.team_id === team_id && row.is_pro === true) continue; // sudah benar
      const { error: uErr } = await db.from("players").update({ team_id, is_pro: true }).eq("account_id", row.account_id);
      if (uErr) throw new Error(`update player ${row.account_id}: ${uErr.message}`);
      if (team_id) teamSet++;
      proSet++;
    }
    if (!rows || rows.length < 1000) break;
  }

  console.log(
    `PRO-PLAYERS DONE. players scanned=${scanned} matched(pro)=${matched} | updated is_pro=true=${proSet} team_id set=${teamSet} team asing (di-null)=${teamForeign}`
  );
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
