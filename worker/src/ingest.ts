/**
 * Ingest worker — Step 2a (vertical slice).
 *
 * Poll OpenDota /proMatches -> tulis matches + picks_bans ke Supabase.
 * Incremental via watermark (ingest_state.last_promatch_id).
 *
 * Arsitektur (CLAUDE.md §3): HANYA worker yang menyentuh OpenDota. UI baca Supabase.
 * Slim: tak simpan telemetry. picks_bans di-mirror persis (urutan + hero + pick/ban) buat spot-check.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (bypass RLS), OPENDOTA_API_KEY (opsional),
 *      INGEST_MAX_MATCHES (batas match baru per run).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { derivePositions } from "./positions";

// ---------- env ----------
const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = requireEnv("SUPABASE_SERVICE_KEY");
// Anggap TIDAK ADA key kalau kosong atau "none" (case-insensitive) — jangan tempel ?api_key.
const rawKey = (process.env.OPENDOTA_API_KEY ?? "").trim();
const OPENDOTA_API_KEY = rawKey.toLowerCase() === "none" ? "" : rawKey;
const MAX_MATCHES = Number(process.env.INGEST_MAX_MATCHES ?? "25");

// Throttle OpenDota: tanpa key ~60 req/min -> 1.1s; dgn key lebih longgar -> 0.35s.
const THROTTLE_MS = OPENDOTA_API_KEY ? 350 : 1100;

const WATERMARK_KEY = "last_promatch_id";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

// ---------- OpenDota response shapes (slim) ----------
interface ProMatch {
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
  team: number; // 0 radiant, 1 dire
  order: number;
}

interface MatchPlayer {
  account_id: number | null;
  player_slot: number;
  hero_id: number;
  isRadiant: boolean;
  win: number; // 1 menang, 0 kalah
  lane_role: number | null;
  net_worth: number | null;
  name: string | null; // nama pro (kalau ada)
  personaname: string | null; // steam persona
}

interface MatchDetail {
  match_id: number;
  picks_bans: PickBan[] | null; // null jika non-Captains-Mode / belum tersedia
  players: MatchPlayer[] | null;
}

interface HeroConst {
  id: number;
  localized_name: string;
  primary_attr: string;
  img: string; // path CDN relatif (portrait), dari /heroStats
}

// ---------- throttled OpenDota fetch (retry transient 5xx / network) ----------
const RETRIES = 2; // total percobaan = RETRIES + 1
let lastCall = 0;

async function opendota<T>(path: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `https://api.opendota.com/api${path}${OPENDOTA_API_KEY ? `${sep}api_key=${OPENDOTA_API_KEY}` : ""}`;

  for (let attempt = 0; ; attempt++) {
    // throttle tiap percobaan (hormati 60 req/min)
    const wait = THROTTLE_MS - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();

    let res: Response;
    try {
      res = await fetch(url);
    } catch (e) {
      // network error -> retry ringan
      if (attempt < RETRIES) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw new Error(`OpenDota ${path} -> network: ${e instanceof Error ? e.message : e}`);
    }

    if (res.ok) return (await res.json()) as T;

    // 5xx transient -> backoff & retry; 4xx -> nyerah langsung
    if (res.status >= 500 && attempt < RETRIES) {
      await sleep(500 * (attempt + 1));
      continue;
    }
    throw new Error(`OpenDota ${path} -> ${res.status} ${res.statusText}`);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------- main ----------
async function main(): Promise<void> {
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  await seedHeroes(db);

  const watermark = await readWatermark(db);
  console.log(`watermark last_promatch_id = ${watermark ?? "(none, first run)"}`);

  const feed = await opendota<ProMatch[]>("/proMatches");
  // Hanya match lebih baru dari watermark; proses urut naik biar watermark = max.
  const fresh = feed
    .filter((m) => watermark === null || m.match_id > watermark)
    .sort((a, b) => a.match_id - b.match_id)
    .slice(0, MAX_MATCHES);

  if (fresh.length === 0) {
    console.log("Tak ada match baru. Selesai.");
    return;
  }
  console.log(`Proses ${fresh.length} match baru (limit ${MAX_MATCHES}).`);

  // Watermark cuma maju di prefix sukses KONTIGU (urut naik). Begitu satu match gagal,
  // berhenti maju biar gak lompati gap — match gagal di-retry run berikutnya. Match sesudahnya
  // tetap di-ingest (idempotent upsert), cuma akan dicek ulang sampai gap terisi.
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
      chainOk = false; // gap: jangan majukan watermark lewat sini
      console.error(`  match ${m.match_id}: SKIP — ${e instanceof Error ? e.message : e}`);
    }
  }

  if (watermarkAdvance > (watermark ?? 0)) await writeWatermark(db, watermarkAdvance);
  console.log(
    `Done. ingested=${ingested} no-draft=${noDraft} failed=${failed}. watermark -> ${watermarkAdvance}`
  );
}

// ---------- heroes seed (FK picks_bans.hero_id) ----------
async function seedHeroes(db: SupabaseClient): Promise<void> {
  // /heroStats (bukan /heroes) karena bawa field `img` (portrait CDN). Simpan path relatif saja.
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

// ---------- per-match ingest ----------
// Draft-first: ambil picks_bans DULU. Match cuma dimasukin kalau draft sukses → no orphan.
// Throw = gagal (fetch error setelah retry) → di-skip + retry run berikutnya.
type IngestStatus = "ingested" | "no-draft";

async function ingestMatch(db: SupabaseClient, m: ProMatch): Promise<IngestStatus> {
  // 1. picks_bans dari /matches/{id} (mirror persis). Fetch dulu sebelum nulis apa pun.
  const detail = await opendota<MatchDetail>(`/matches/${m.match_id}`);
  if (!detail.picks_bans || detail.picks_bans.length === 0) {
    // Non-CM / draft tak tersedia: bukan error. Jangan masukin match (no orphan). Watermark boleh maju.
    console.log(`  match ${m.match_id}: tak ada picks_bans (non-CM), skip — tak dimasukin.`);
    return "no-draft";
  }

  // 2. league (FK matches.league_id)
  if (m.leagueid && m.leagueid > 0) {
    const { error } = await db
      .from("leagues")
      .upsert({ league_id: m.leagueid, name: m.league_name }, { onConflict: "league_id" });
    if (error) throw new Error(`upsert league ${m.leagueid}: ${error.message}`);
  }

  // 3. teams (FK matches.radiant/dire_team_id; nullable kalau id kosong)
  await upsertTeam(db, m.radiant_team_id, m.radiant_name);
  await upsertTeam(db, m.dire_team_id, m.dire_name);

  // 4. match (slim, patch_id null sampai job patch-tag)
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

  // 5. picks_bans: delete+insert biar mirror tepat (re-ingest tak tinggalin baris basi).
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

  // 6. match_players + posisi 1-5 (heuristik net-worth-first).
  const mpCount = await ingestMatchPlayers(db, m.match_id, detail.players ?? []);
  console.log(`  match ${m.match_id}: ${pbRows.length} picks/bans, ${mpCount} players.`);
  return "ingested";
}

async function ingestMatchPlayers(
  db: SupabaseClient,
  matchId: number,
  players: MatchPlayer[]
): Promise<number> {
  const valid = players.filter((p) => p.hero_id && p.hero_id > 0);
  if (valid.length === 0) return 0;

  // Seed players dulu (FK match_players.account_id). Anonymous (account_id null) di-skip di sini.
  const playerRows = valid
    .filter((p) => p.account_id)
    .map((p) => ({ account_id: p.account_id, name: p.name ?? p.personaname ?? null }));
  if (playerRows.length > 0) {
    const { error } = await db.from("players").upsert(playerRows, { onConflict: "account_id" });
    if (error) throw new Error(`upsert players ${matchId}: ${error.message}`);
  }

  // Derive posisi per sisi.
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

  // Mirror tepat (delete+insert) biar re-ingest tak tinggalin baris basi.
  const { error: delErr } = await db.from("match_players").delete().eq("match_id", matchId);
  if (delErr) throw new Error(`delete match_players ${matchId}: ${delErr.message}`);
  const { error: insErr } = await db.from("match_players").insert(rows);
  if (insErr) throw new Error(`insert match_players ${matchId}: ${insErr.message}`);
  return rows.length;
}

async function upsertTeam(
  db: SupabaseClient,
  teamId: number | null,
  name: string | null
): Promise<void> {
  if (!teamId || teamId <= 0) return;
  const { error } = await db
    .from("teams")
    .upsert({ team_id: teamId, name }, { onConflict: "team_id" });
  if (error) throw new Error(`upsert team ${teamId}: ${error.message}`);
}

// ---------- watermark ----------
async function readWatermark(db: SupabaseClient): Promise<number | null> {
  const { data, error } = await db
    .from("ingest_state")
    .select("value")
    .eq("key", WATERMARK_KEY)
    .maybeSingle();
  if (error) throw new Error(`read watermark: ${error.message}`);
  return data ? Number(data.value) : null;
}

async function writeWatermark(db: SupabaseClient, value: number): Promise<void> {
  const { error } = await db.from("ingest_state").upsert(
    { key: WATERMARK_KEY, value: String(value), updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (error) throw new Error(`write watermark: ${error.message}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
