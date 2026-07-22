import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase, pageAll } from "@/lib/supabase";
import PrintButton from "./PrintButton";
import Filters from "./Filters";
import Section from "./Section";
import PoolAccordion from "./PoolAccordion";
import RoleDuos from "./RoleDuos";
import CondPickBan from "./CondPickBan";

// FR-2 v2 (dark modern) — team analysis: header + filter(patch/tournament) + position-pool + tabel/chart.
// chunk1: semua data di-scope by patch (mandatory) + tournament (single). Query on-the-fly dari raw
// (matches + match_players + picks_bans), bukan agg table.
export const dynamic = "force-dynamic";

const CDN = "https://cdn.cloudflare.steamstatic.com";
const MATCH_CAP = 80; // batasi match_players/picks_bans < 1000 baris (limit PostgREST)

// FIX-A: conditional pick→ban pakai LIFT (smoothed). Panel ini all-time team-wide (decoupled dari
// filter patch/tournament) → butuh volume. K = pseudo-match smoothing, shrink lift ke baseline biar
// nggak meledak di n kecil. Data tipis → gampang tweak (turunin ke 3 kalau semua lift flat ~1).
const LIFT_SMOOTHING_K = 5;
const COND_PICK_GATE = 4; // pX minimal biar hero X ditampilkan (display floor, adaptif)
const COND_RELIABLE_PX = 8; // pX >= ini = "reliable"; 4-7 = indikatif/sample kecil (dimmed)
const COND_CO_GATE = 2; // co minimal biar hero Y jadi coban X (buang noise 1x)

interface MetaRow {
  match_id: number;
  radiant_team_id: number | null;
  dire_team_id: number | null;
  radiant_win: boolean | null;
  league_id: number | null;
  patch_id: number | null;
  start_time: number | null;
  duration: number | null;
  league: { name: string | null } | null;
  patch: { id: number; name: string | null; start_time: number | null } | null;
  radiant: { name: string | null } | null;
  dire: { name: string | null } | null;
}
interface MpRow {
  match_id: number;
  account_id: number | null;
  hero_id: number;
  is_radiant: boolean;
  position: number | null;
  win: boolean | null;
  lane_result: number | null; // STRATZ: 1 won, 0 tie, -1 lost, null roam/no-lane
  net_worth: number | null; // buat Method C fallback (core/support split)
  lane_role: number | null; // 1 safe / 2 mid / 3 off / 4 jungle — Method C carry/off/mid
  player: { name: string | null } | null;
  hero: { localized_name: string | null; img: string | null } | null;
}
interface RoleRow {
  account_id: number;
  name: string | null;
  position: number | null; // 1-5 STRATZ (null = unknown/non-pro)
  is_active: boolean; // roster aktif vs standin
}
interface PbRow {
  match_id: number;
  ord: number;
  is_pick: boolean;
  hero_id: number;
  team: number; // 0 = radiant, 1 = dire
  hero: { localized_name: string | null; img: string | null } | null;
}
// drill-down (dikirim ke client accordion)
export interface DrillPick {
  name: string;
  img: string | null;
}
export interface DrillMatch {
  matchId: number;
  start_time: number | null;
  duration: number | null;
  win: boolean | null;
  laneResult: number | null; // lane_result hero yang di-drill di match ini (1/0/-1/null)
  oppId: number | null;
  oppName: string;
  teamPicks: DrillPick[];
  oppPicks: DrillPick[];
  teamBans: DrillPick[];
  oppBans: DrillPick[];
}
export interface PoolHero {
  hero_id: number;
  name: string;
  img: string | null;
  games: number;
  wins: number;
  matches: DrillMatch[];
}
export interface OtherHero {
  hero_id: number;
  name: string;
  img: string | null;
  games: number;
  wins: number;
}
export interface OtherPlayer {
  playerId: number | null;
  name: string;
  games: number; // # game player ini di posisi ini (scope filter)
  heroes: OtherHero[]; // #Step3: hero yang standin ini pick (games desc) + W-L
}
export interface PosData {
  pos: number;
  label: string;
  playerId: number | null; // pemain yang DITAMPILKAN (main resmi, atau standin kalau main 0 game)
  playerName: string;
  mainGames: number; // game pemain yang ditampilkan
  source: "stratz" | "method_c"; // sumber role: roster kanonik STRATZ vs derivasi
  isStandinRow: boolean; // true = baris utama ini standin (main resmi 0 game)
  canonicalMainName: string | null; // nama main resmi roster (buat label kalau 0 game / di-standin-in)
  pool: PoolHero[];
  others: OtherPlayer[]; // standin/pemain lain SISANYA, games desc
}
// duo-lane win-lane% (STRATZ lane_result, rep core: safe=pos1, mid=pos2, off=pos3)
interface LaneAgg {
  label: string;
  won: number;
  tie: number;
  lost: number;
}
// #2 role-duo pairing (GAME winrate)
interface DuoHero {
  hero_id: number;
  name: string;
  img: string | null;
}
export interface Duo {
  a: DuoHero;
  b: DuoHero;
  games: number;
  wins: number;
}
export interface RoleDuoGroup {
  label: string;
  duos: Duo[];
}
// #6 lane matchup vs lawan (current filter scope): duo lane kita vs duo lawan berhadapan, W/L lane (core).
interface MatchupHero {
  name: string;
  img: string | null;
}
interface LaneMatchup {
  matchId: number;
  start_time: number | null;
  ourDuo: MatchupHero[]; // 1-2 hero lane kita
  oppDuo: MatchupHero[]; // 1-2 hero lane lawan berhadapan
  oppId: number | null;
  oppName: string;
  laneResult: number | null; // lane_result core kita: 1 W / 0 tie / -1 L / null no-data
}
interface LaneMatchupGroup {
  label: string;
  matchups: LaneMatchup[];
}
// #3 conditional pick → ban (FIX-A: lift-based)
export interface CondBan {
  hero_id: number;
  name: string;
  img: string | null;
  co: number; // # match tim pick X & ban Y
  lift: number; // smoothed lift = P(ban Y|pick X) / P(ban Y)
  confidence: number; // co/pX dalam persen (0-100)
}
export interface CondPick {
  hero_id: number;
  name: string;
  img: string | null;
  pickCount: number; // # match tim pick X (>= gate)
  reliable: boolean; // pX >= COND_RELIABLE_PX (8); false = indikatif/sample kecil
  cobans: CondBan[]; // urut lift desc
}

function heroSrc(img: string | null | undefined): string | null {
  if (!img) return null;
  return img.startsWith("http") ? img : `${CDN}${img}`;
}
// winrate → kelas warna (winrate SAJA). >=55 win, <45 loss, else mid.
function wrClass(wins: number, games: number): "win" | "loss" | "mid" {
  if (games === 0) return "mid";
  const wr = wins / games;
  return wr >= 0.55 ? "win" : wr < 0.45 ? "loss" : "mid";
}
function wrPct(wins: number, games: number): number {
  return games ? Math.round((wins / games) * 100) : 0;
}
function wrColor(wins: number, games: number): string {
  const c = wrClass(wins, games);
  return c === "win" ? "wr-good" : c === "loss" ? "wr-bad" : "wr-mid";
}
function fmtDate(epoch: number | null | undefined): string {
  if (!epoch) return "—";
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}
function median(a: number[]): number {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
function modeOf(a: number[]): number | null {
  const c = new Map<number, number>();
  for (const x of a) c.set(x, (c.get(x) ?? 0) + 1);
  let best: number | null = null;
  let bn = -1;
  for (const [k, n] of c) if (n > bn) ((bn = n), (best = k));
  return best;
}

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: { team_id: string };
  searchParams: { patch?: string; league?: string };
}) {
  const id = Number(params.team_id);

  if (!Number.isFinite(id)) {
    return (
      <main className="container">
        <p>team_id tidak valid.</p>
      </main>
    );
  }

  const supabase = getServerSupabase();

  const [aliasRes, teamRes, metaRes, rolesRes] = await Promise.all([
    // entity resolution: id alias → redirect ke canonical (matches udah di-rewrite ke canonical)
    supabase
      .from("team_aliases")
      .select("canonical_team_id")
      .eq("alias_team_id", id)
      .maybeSingle<{ canonical_team_id: number }>(),
    supabase.from("teams").select("name, rating, logo_url").eq("team_id", id).maybeSingle<{
      name: string | null;
      rating: number | null;
      logo_url: string | null;
    }>(),
    supabase
      .from("matches")
      .select(
        `match_id, radiant_team_id, dire_team_id, radiant_win, league_id, patch_id, start_time, duration,
         league:leagues!matches_league_id_fkey(name),
         patch:patches!matches_patch_id_fkey(id, name, start_time),
         radiant:teams!matches_radiant_team_id_fkey(name),
         dire:teams!matches_dire_team_id_fkey(name)`
      )
      .or(`radiant_team_id.eq.${id},dire_team_id.eq.${id}`)
      .order("start_time", { ascending: false })
      .returns<MetaRow[]>(),
    // Step 2: roster kanonik STRATZ (team_player_roles). Kosong → fallback Method C.
    supabase
      .from("team_player_roles")
      .select("account_id, name, position, is_active")
      .eq("team_id", id)
      .returns<RoleRow[]>(),
  ]);

  if (aliasRes.data) redirect(`/teams/${aliasRes.data.canonical_team_id}`);

  const team = teamRes.data;
  const teamName = team?.name ?? `Team ${id}`;
  const allMeta = (metaRes.data ?? []).filter((m) => m.patch_id !== null);

  // patch options (distinct, urut terbaru dulu by patches.start_time)
  const patchMap = new Map<number, { id: number; name: string; start_time: number }>();
  for (const m of allMeta) {
    if (m.patch_id == null) continue;
    if (!patchMap.has(m.patch_id))
      patchMap.set(m.patch_id, {
        id: m.patch_id,
        name: m.patch?.name ?? `Patch ${m.patch_id}`,
        start_time: m.patch?.start_time ?? 0,
      });
  }
  const patches = [...patchMap.values()].sort((a, b) => b.start_time - a.start_time);

  if (patches.length === 0) {
    const initials0 = teamName.slice(0, 2).toUpperCase();
    return (
      <main className="container">
        <div className="team-header">
          {team?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="team-logo" src={team.logo_url} alt={teamName} width={56} height={56} />
          ) : (
            <div className="team-logo-fallback">{initials0}</div>
          )}
          <div>
            <div className="team-title">{teamName}</div>
            <div className="team-meta">
              Belum ada match ter-tag patch untuk tim ini. <Link href="/teams">← Balik ke Teams</Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // patch terpilih: dari query kalau valid, else terbaru
  const qPatch = Number(searchParams.patch);
  const selectedPatch = patchMap.has(qPatch) ? qPatch : patches[0]!.id;

  // match dalam patch terpilih → tournament options
  const inPatch = allMeta.filter((m) => m.patch_id === selectedPatch);
  const leagueMap = new Map<number, string>();
  for (const m of inPatch)
    if (m.league_id) leagueMap.set(m.league_id, m.league?.name ?? `League ${m.league_id}`);
  const leagues = [...leagueMap.entries()]
    .map(([lid, name]) => ({ id: lid, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // tournament terpilih (single) — null = All this patch
  const qLeague = Number(searchParams.league);
  const selectedLeague = leagueMap.has(qLeague) ? qLeague : null;

  // scope final + cap recent 80 (record/pool/picks pakai set yang sama → konsisten)
  const filtered = inPatch
    .filter((m) => selectedLeague === null || m.league_id === selectedLeague)
    .slice(0, MATCH_CAP);

  // sisi tim per match + rekor + side winrate
  const side = new Map<number, boolean>(); // match_id -> isRadiant(team)
  const won = new Map<number, boolean>(); // match_id -> team menang
  let wins = 0;
  let losses = 0;
  const sideStat = { radG: 0, radW: 0, dirG: 0, dirW: 0 };
  for (const m of filtered) {
    const isRad = m.radiant_team_id === id;
    side.set(m.match_id, isRad);
    if (m.radiant_win !== null) {
      const w = (isRad && m.radiant_win) || (!isRad && !m.radiant_win);
      won.set(m.match_id, w);
      if (w) wins++;
      else losses++;
      if (isRad) {
        sideStat.radG++;
        if (w) sideStat.radW++;
      } else {
        sideStat.dirG++;
        if (w) sideStat.dirW++;
      }
    }
  }

  const matchIds = filtered.map((m) => m.match_id);

  // match_players + picks_bans untuk scope terpilih
  let teamMp: MpRow[] = [];
  let oppMp: MpRow[] = []; // #6: sisi lawan (buat lane matchup)
  let teamPb: PbRow[] = [];
  let allPb: PbRow[] = [];
  if (matchIds.length > 0) {
    // paginate: match_players (~10/match) + picks_bans (~24/match) bisa > 1000 baris utk banyak match.
    const [mpAll, pbAll] = await Promise.all([
      pageAll<MpRow>((f, t) =>
        supabase
          .from("match_players")
          .select(
            `match_id, account_id, hero_id, is_radiant, position, win, lane_result, net_worth, lane_role,
             player:players!match_players_account_id_fkey(name),
             hero:heroes!match_players_hero_id_fkey(localized_name, img)`
          )
          .in("match_id", matchIds)
          .order("match_id")
          .order("hero_id")
          .range(f, t)
          .returns<MpRow[]>()
      ),
      pageAll<PbRow>((f, t) =>
        supabase
          .from("picks_bans")
          .select(
            `match_id, ord, is_pick, hero_id, team,
             hero:heroes!picks_bans_hero_id_fkey(localized_name, img)`
          )
          .in("match_id", matchIds)
          .order("match_id")
          .order("ord")
          .range(f, t)
          .returns<PbRow[]>()
      ),
    ]);
    teamMp = mpAll.filter((r) => side.get(r.match_id) === r.is_radiant);
    oppMp = mpAll.filter((r) => side.get(r.match_id) !== r.is_radiant);
    allPb = pbAll;
    // hanya pick/ban milik sisi tim: (team===0)===isRadiant
    teamPb = allPb.filter((r) => side.get(r.match_id) === (r.team === 0));
  }

  // picks_bans per match (buat drill-down: butuh kedua sisi)
  const pbByMatch = new Map<number, PbRow[]>();
  for (const r of allPb) {
    const arr = pbByMatch.get(r.match_id) ?? [];
    arr.push(r);
    pbByMatch.set(r.match_id, arr);
  }
  const metaById = new Map(filtered.map((m) => [m.match_id, m]));
  const startTimeById = new Map(filtered.map((m) => [m.match_id, m.start_time ?? 0]));
  // lane_result per (match, hero) tim → dipakai di drill indicator
  const laneByMatchHero = new Map<string, number | null>();
  for (const r of teamMp) laneByMatchHero.set(`${r.match_id}:${r.hero_id}`, r.lane_result);

  function toPick(r: PbRow): DrillPick {
    return { name: r.hero?.localized_name ?? String(r.hero_id), img: r.hero?.img ?? null };
  }
  // matches (recent 20) di mana tim pick hero H di posisi P — full draft kedua sisi.
  function buildDrill(heroId: number, matchIdsForHero: number[]): DrillMatch[] {
    return matchIdsForHero
      .slice()
      .sort((a, b) => (startTimeById.get(b) ?? 0) - (startTimeById.get(a) ?? 0))
      .slice(0, 20)
      .map((mid) => {
        const meta = metaById.get(mid);
        const isRad = side.get(mid) === true;
        const pbs = (pbByMatch.get(mid) ?? []).slice().sort((a, b) => a.ord - b.ord);
        const teamPickRows = pbs.filter((p) => p.is_pick && (p.team === 0) === isRad);
        const oppPickRows = pbs.filter((p) => p.is_pick && (p.team === 0) !== isRad);
        const teamBanRows = pbs.filter((p) => !p.is_pick && (p.team === 0) === isRad);
        const oppBanRows = pbs.filter((p) => !p.is_pick && (p.team === 0) !== isRad);
        return {
          matchId: mid,
          start_time: meta?.start_time ?? null,
          duration: meta?.duration ?? null,
          win: won.has(mid) ? won.get(mid)! : null,
          laneResult: laneByMatchHero.get(`${mid}:${heroId}`) ?? null,
          oppId: (isRad ? meta?.dire_team_id : meta?.radiant_team_id) ?? null,
          oppName: (isRad ? meta?.dire?.name : meta?.radiant?.name) ?? "Unknown",
          teamPicks: teamPickRows.map(toPick),
          oppPicks: oppPickRows.map(toPick),
          teamBans: teamBanRows.map(toPick),
          oppBans: oppBanRows.map(toPick),
        };
      });
  }

  const POS_LABEL = ["", "Pos 1 · Carry", "Pos 2 · Mid", "Pos 3 · Off", "Pos 4 · Soft sup", "Pos 5 · Hard sup"];

  // Step 2: role KANONIK per (tim, player) dari team_player_roles (STRATZ). Group pool by role kanonik,
  // BUKAN per-match position (yang flip antar game). match_players.position tetap dipakai lane_result/drill.
  const rolesData = rolesRes.data ?? [];
  const activeMain = new Map<number, { account_id: number; name: string }>(); // pos → main (roster aktif)
  // roleByAccount HANYA roster AKTIF. Standin SENGAJA tak dimasukin: role global STRATZ-nya (mis. jikroy
  // = pos5 global) ≠ posisi yang dia ISI pas standin (jikroy main carry/pos1). Standin di-klasifikasi
  // via posisi yang BENERAN dimainin (posModeByAccount) di bawah, bukan role global.
  const roleByAccount = new Map<number, number>(); // account_id → pos kanonik (AKTIF saja)
  const nameByAccount = new Map<number, string>();
  for (const r of rolesData) {
    if (r.name) nameByAccount.set(r.account_id, r.name);
    if (r.position == null) continue;
    if (r.is_active) {
      roleByAccount.set(r.account_id, r.position);
      if (!activeMain.has(r.position))
        activeMain.set(r.position, { account_id: r.account_id, name: r.name ?? `Player ${r.account_id}` });
    }
  }
  // nama dari data match (fallback kalau roster gak punya nama / player non-roster)
  for (const r of teamMp) if (r.account_id != null && r.player?.name) nameByAccount.set(r.account_id, r.player.name);

  const hasCanonical = activeMain.size > 0;
  const rosterSource: "stratz" | "method_c" = hasCanonical ? "stratz" : "method_c";

  // FALLBACK Method C (tim tanpa roster STRATZ aktif): core/support by median NW, mid/carry/off by lane_role.
  const mcMain = new Map<number, { account_id: number; name: string }>();
  const mcRoleByAccount = new Map<number, number>();
  if (!hasCanonical) {
    const agg = new Map<number, { games: number; nws: number[]; lrs: number[] }>();
    for (const r of teamMp) {
      if (r.account_id == null) continue;
      const v = agg.get(r.account_id) ?? { games: 0, nws: [], lrs: [] };
      v.games++;
      if (r.net_worth != null) v.nws.push(r.net_worth);
      if (r.lane_role != null) v.lrs.push(r.lane_role);
      agg.set(r.account_id, v);
    }
    const roster = [...agg.entries()]
      .map(([acct, v]) => ({ acct, games: v.games, mnw: median(v.nws), lrMode: modeOf(v.lrs) }))
      .sort((a, b) => b.games - a.games)
      .slice(0, 5);
    if (roster.length > 0) {
      const byNw = [...roster].sort((a, b) => b.mnw - a.mnw);
      const cores = byNw.slice(0, 3);
      const sups = byNw.slice(3, 5);
      const mid = cores.find((p) => p.lrMode === 2) ?? [...cores].sort((a, b) => b.mnw - a.mnw)[1]!;
      const coreRest = cores.filter((p) => p !== mid);
      let carry = coreRest.find((p) => p.lrMode === 1);
      let off = coreRest.find((p) => p.lrMode === 3);
      if (!carry || !off || carry === off) {
        const s = [...coreRest].sort((a, b) => b.mnw - a.mnw);
        carry = s[0];
        off = s[1];
      }
      const supSorted = [...sups].sort((a, b) => b.mnw - a.mnw);
      const pairs: [number, { acct: number } | undefined][] = [
        [1, carry],
        [2, mid],
        [3, off],
        [4, supSorted[0]],
        [5, supSorted[1]],
      ];
      for (const [pos, p] of pairs) {
        if (!p) continue;
        mcMain.set(pos, { account_id: p.acct, name: nameByAccount.get(p.acct) ?? `Player ${p.acct}` });
        mcRoleByAccount.set(p.acct, pos);
      }
    }
  }

  const mains = hasCanonical ? activeMain : mcMain;
  const roleMap = hasCanonical ? roleByAccount : mcRoleByAccount;

  // player non-roster (gak dikenal STRATZ / Method C) → pos kanonik = MODE per-match position mereka.
  const posModeByAccount = new Map<number, number>();
  {
    const cnt = new Map<number, Map<number, number>>();
    for (const r of teamMp) {
      if (r.account_id == null || r.position == null) continue;
      const m = cnt.get(r.account_id) ?? new Map<number, number>();
      m.set(r.position, (m.get(r.position) ?? 0) + 1);
      cnt.set(r.account_id, m);
    }
    for (const [acct, m] of cnt) {
      let best = -1;
      let bp = 0;
      for (const [p, c] of m) if (c > best) ((best = c), (bp = p));
      posModeByAccount.set(acct, bp);
    }
  }
  const canonPosOf = (acct: number): number | null => roleMap.get(acct) ?? posModeByAccount.get(acct) ?? null;

  // total game per account (buat +N others)
  const gamesByAccount = new Map<number, number>();
  for (const r of teamMp) if (r.account_id != null) gamesByAccount.set(r.account_id, (gamesByAccount.get(r.account_id) ?? 0) + 1);

  // #Step3: hero pool per account (buat detail standin di +N other) — games desc + W-L.
  const heroesByAccount = new Map<number, Map<number, { name: string; img: string | null; games: number; wins: number }>>();
  for (const r of teamMp) {
    if (r.account_id == null) continue;
    const hm = heroesByAccount.get(r.account_id) ?? new Map();
    const h =
      hm.get(r.hero_id) ??
      { name: r.hero?.localized_name ?? String(r.hero_id), img: r.hero?.img ?? null, games: 0, wins: 0 };
    h.games++;
    if (r.win) h.wins++;
    hm.set(r.hero_id, h);
    heroesByAccount.set(r.account_id, hm);
  }
  const heroesOf = (acct: number): OtherHero[] =>
    [...(heroesByAccount.get(acct)?.entries() ?? [])]
      .map(([hero_id, v]) => ({ hero_id, name: v.name, img: v.img, games: v.games, wins: v.wins }))
      .sort((a, b) => b.games - a.games);

  // hero pool (PoolHero[] + drill) untuk 1 account — semua game-nya (role tetap, gak filter per-match pos).
  function poolFor(acct: number | null): PoolHero[] {
    if (acct == null) return [];
    const heroMap = new Map<
      number,
      { name: string; img: string | null; games: number; wins: number; matchIds: number[] }
    >();
    for (const r of teamMp) {
      if (r.account_id !== acct) continue;
      const h =
        heroMap.get(r.hero_id) ??
        { name: r.hero?.localized_name ?? String(r.hero_id), img: r.hero?.img ?? null, games: 0, wins: 0, matchIds: [] };
      h.games++;
      if (r.win) h.wins++;
      h.matchIds.push(r.match_id);
      heroMap.set(r.hero_id, h);
    }
    return [...heroMap.entries()]
      .map(([hero_id, v]) => ({
        hero_id,
        name: v.name,
        img: v.img,
        games: v.games,
        wins: v.wins,
        matches: buildDrill(hero_id, v.matchIds),
      }))
      .sort((a, b) => b.games - a.games);
  }

  // position-pool: main kanonik. Kalau main resmi 0 game TAPI ada player berdata → promote yang
  // games terbanyak jadi baris utama (pool + W-L-nya).
  //   - Main resmi ADA (roster STRATZ punya pos ini) → promoted = STANDIN (badge, main resmi disebut).
  //   - Main resmi TAK ADA (roster bolong, mis. REKONIX no P1) → promoted = DE-FACTO MAIN (no badge).
  const positions: PosData[] = [1, 2, 3, 4, 5].map((pos) => {
    const main = mains.get(pos) ?? null;
    const mainAcct = main?.account_id ?? null;
    const canonicalMainName = main?.name ?? null;

    // semua akun lain di pos ini (kanonik) yang punya game, games desc.
    const otherAccts = [...gamesByAccount.entries()]
      .filter(([acct]) => acct !== mainAcct && canonPosOf(acct) === pos)
      .sort((a, b) => b[1] - a[1])
      .map(([acct]) => acct);

    const mainGamesRaw = mainAcct != null ? gamesByAccount.get(mainAcct) ?? 0 : 0;

    // pilih siapa yang jadi BARIS UTAMA
    let displayAcct = mainAcct;
    let displayName = main?.name ?? "—";
    let isStandinRow = false;
    let restAccts = otherAccts;
    if (mainGamesRaw === 0 && otherAccts.length > 0) {
      displayAcct = otherAccts[0]!; // games terbanyak
      displayName = nameByAccount.get(displayAcct) ?? `Player ${displayAcct}`;
      isStandinRow = main != null; // STANDIN cuma kalau ada main resmi; roster bolong → de-facto main
      restAccts = otherAccts.slice(1);
    }

    const pool = poolFor(displayAcct);
    const mainGames = pool.reduce((s, h) => s + h.games, 0);

    const others: OtherPlayer[] = restAccts.map((acct) => ({
      playerId: acct > 0 ? acct : null,
      name: nameByAccount.get(acct) ?? `Player ${acct}`,
      games: gamesByAccount.get(acct) ?? 0,
      heroes: heroesOf(acct),
    }));

    return {
      pos,
      label: POS_LABEL[pos]!,
      playerId: displayAcct && displayAcct > 0 ? displayAcct : null,
      playerName: displayName,
      mainGames,
      source: rosterSource,
      isStandinRow,
      canonicalMainName,
      pool,
      others,
    };
  });

  // duo-lane win-lane% (STRATZ lane_result) — rep core: safe=pos1, mid=pos2, off=pos3. null di-skip.
  function laneAggFor(pos: number, label: string): LaneAgg {
    const a: LaneAgg = { label, won: 0, tie: 0, lost: 0 };
    for (const r of teamMp) {
      if (r.position !== pos || r.lane_result == null) continue;
      if (r.lane_result === 1) a.won++;
      else if (r.lane_result === 0) a.tie++;
      else if (r.lane_result === -1) a.lost++;
    }
    return a;
  }
  const laneAggs: LaneAgg[] = [
    laneAggFor(1, "Safelane"),
    laneAggFor(2, "Mid"),
    laneAggFor(3, "Offlane"),
  ];

  // #2 role-duo: per match position→hero (tim), lalu pair hero per role-duo. GAME winrate.
  const posHeroByMatch = new Map<number, Map<number, DuoHero>>();
  for (const r of teamMp) {
    if (r.position == null) continue;
    const pm = posHeroByMatch.get(r.match_id) ?? new Map<number, DuoHero>();
    pm.set(r.position, {
      hero_id: r.hero_id,
      name: r.hero?.localized_name ?? String(r.hero_id),
      img: r.hero?.img ?? null,
    });
    posHeroByMatch.set(r.match_id, pm);
  }
  function duoGroup(label: string, px: number, py: number): RoleDuoGroup {
    const map = new Map<string, Duo>();
    for (const [mid, pm] of posHeroByMatch) {
      const a = pm.get(px);
      const b = pm.get(py);
      if (!a || !b) continue;
      const key = `${a.hero_id}:${b.hero_id}`;
      const d = map.get(key) ?? { a, b, games: 0, wins: 0 };
      d.games++;
      if (won.get(mid)) d.wins++;
      map.set(key, d);
    }
    return {
      label,
      duos: [...map.values()].sort((x, y) => y.games - x.games || y.wins - x.wins),
    };
  }
  // FIX-B: cuma lane-duo fisik nyata — Safelane (1+5) + Offlane (3+4). Mid-duo dihapus (mid solo).
  const roleDuoGroups: RoleDuoGroup[] = [
    duoGroup("Safelane · 1+5", 1, 5),
    duoGroup("Offlane · 3+4", 3, 4),
  ];

  // #6 lane matchup — pakai lane_role (lane ASLI OpenDota), pairing lane FISIK. BUKAN posisi net-worth.
  // Skip kalau gak ada lawan di lane fisik yang sama (swap/uncontested/roam) — cuma konfrontasi beneran.
  const physLane = (laneRole: number | null, isRad: boolean): "top" | "mid" | "bottom" | null => {
    if (laneRole === 2) return "mid";
    if (laneRole === 1) return isRad ? "bottom" : "top"; // SAFE
    if (laneRole === 3) return isRad ? "top" : "bottom"; // OFF
    return null; // jungle(4)/roam/null → gak dinilai
  };
  const heroOf = (r: MpRow): MatchupHero => ({ name: r.hero?.localized_name ?? String(r.hero_id), img: r.hero?.img ?? null });
  const nwDesc = (a: MpRow, b: MpRow) => (b.net_worth ?? 0) - (a.net_worth ?? 0);
  const ourByMatch = new Map<number, MpRow[]>();
  const oppByMatch = new Map<number, MpRow[]>();
  for (const r of teamMp) {
    const a = ourByMatch.get(r.match_id) ?? [];
    a.push(r);
    ourByMatch.set(r.match_id, a);
  }
  for (const r of oppMp) {
    const a = oppByMatch.get(r.match_id) ?? [];
    a.push(r);
    oppByMatch.set(r.match_id, a);
  }

  // LANE = lane_role kita (1 SAFE / 2 MID / 3 OFF). Lawan = siapa pun di physical lane yang sama.
  function laneMatchupGroup(label: string, ourLaneRole: 1 | 2 | 3): LaneMatchupGroup {
    const rows: LaneMatchup[] = [];
    for (const m of filtered) {
      const isRad = side.get(m.match_id) === true;
      const ours = (ourByMatch.get(m.match_id) ?? []).filter((r) => r.lane_role === ourLaneRole);
      if (ours.length === 0) continue; // gak ada pemain kita di lane ini
      const phys = physLane(ourLaneRole, isRad);
      if (!phys) continue;
      const opps = (oppByMatch.get(m.match_id) ?? []).filter((r) => physLane(r.lane_role, r.is_radiant) === phys);
      if (opps.length === 0) continue; // gak ada lawan di lane fisik ini → SKIP (swap/uncontested/roam)
      // W/L lane: rep = core kita (net_worth tertinggi) yang lane_result-nya non-null.
      const withRes = ours.filter((r) => r.lane_result != null).sort(nwDesc);
      rows.push({
        matchId: m.match_id,
        start_time: m.start_time ?? null,
        ourDuo: [...ours].sort(nwDesc).map(heroOf),
        oppDuo: [...opps].sort(nwDesc).map(heroOf),
        oppId: (isRad ? m.dire_team_id : m.radiant_team_id) ?? null,
        oppName: (isRad ? m.dire?.name : m.radiant?.name) ?? "Unknown",
        laneResult: withRes.length ? withRes[0]!.lane_result! : null,
      });
    }
    rows.sort((a, b) => (b.start_time ?? 0) - (a.start_time ?? 0));
    return { label, matchups: rows.slice(0, 20) };
  }
  const laneMatchups: LaneMatchupGroup[] = [
    laneMatchupGroup("Safelane", 1),
    laneMatchupGroup("Midlane", 2),
    laneMatchupGroup("Offlane", 3),
  ].filter((g) => g.matchups.length > 0);

  // #3 conditional pick → ban — FIX-A: LIFT (smoothed), ALL-TIME TEAM-WIDE (decoupled dari filter).
  // lift(Y|X) = P(ban Y | pick X) / P(ban Y). p di-shrink ke baseline q pakai K → anti-explosion n kecil.
  const allTeamMatches = metaRes.data ?? [];
  const gSide = new Map<number, boolean>(); // match_id -> team isRadiant
  for (const m of allTeamMatches) gSide.set(m.match_id, m.radiant_team_id === id);
  const allTeamIds = allTeamMatches.map((m) => m.match_id);

  // AMBIL SEMUA picks_bans (bisa > 1000 baris) via range pagination — jangan truncate diam-diam.
  async function fetchAllPb(ids: number[]): Promise<PbRow[]> {
    if (ids.length === 0) return [];
    const PAGE = 1000;
    const out: PbRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data } = await supabase
        .from("picks_bans")
        .select(
          `match_id, ord, is_pick, hero_id, team,
           hero:heroes!picks_bans_hero_id_fkey(localized_name, img)`
        )
        .in("match_id", ids)
        .order("match_id", { ascending: true })
        .order("ord", { ascending: true })
        .range(from, from + PAGE - 1)
        .returns<PbRow[]>();
      const rows = data ?? [];
      out.push(...rows);
      if (rows.length < PAGE) break; // halaman terakhir → habis
    }
    return out;
  }
  const globalPb = await fetchAllPb(allTeamIds);
  const gTeamPb = globalPb.filter((r) => gSide.get(r.match_id) === (r.team === 0));

  // set pick/ban per match (dedupe per match) + meta hero
  const gHeroMeta = new Map<number, { name: string; img: string | null }>();
  const gPickByMatch = new Map<number, Set<number>>();
  const gBanByMatch = new Map<number, Set<number>>();
  const draftMatches = new Set<number>();
  for (const r of gTeamPb) {
    draftMatches.add(r.match_id);
    gHeroMeta.set(r.hero_id, {
      name: r.hero?.localized_name ?? String(r.hero_id),
      img: r.hero?.img ?? null,
    });
    const map = r.is_pick ? gPickByMatch : gBanByMatch;
    const s = map.get(r.match_id) ?? new Set<number>();
    s.add(r.hero_id);
    map.set(r.match_id, s);
  }
  const condM = draftMatches.size; // total match tim (punya draft) = denominator baseline

  const gPickCount = new Map<number, number>();
  const gBanCount = new Map<number, number>();
  for (const s of gPickByMatch.values()) for (const h of s) gPickCount.set(h, (gPickCount.get(h) ?? 0) + 1);
  for (const s of gBanByMatch.values()) for (const h of s) gBanCount.set(h, (gBanCount.get(h) ?? 0) + 1);

  const coMap = new Map<number, Map<number, number>>(); // X -> (Y -> co)
  for (const [mid, picks] of gPickByMatch) {
    const bans = gBanByMatch.get(mid);
    if (!bans) continue;
    for (const x of picks) {
      const ym = coMap.get(x) ?? new Map<number, number>();
      for (const y of bans) ym.set(y, (ym.get(y) ?? 0) + 1);
      coMap.set(x, ym);
    }
  }

  const condPicks: CondPick[] = [];
  if (condM > 0) {
    for (const [x, pX] of gPickCount) {
      if (pX < COND_PICK_GATE) continue; // sample gate X: pick X < 8 → skip (sample kecil)
      const ym = coMap.get(x);
      if (!ym) continue;
      const cobans: CondBan[] = [];
      for (const [y, coCount] of ym) {
        if (coCount < COND_CO_GATE) continue; // sample gate Y
        const bY = gBanCount.get(y) ?? 0;
        const q = bY / condM; // baseline: seberapa sering Y diban overall
        if (q <= 0) continue;
        const p = (coCount + LIFT_SMOOTHING_K * q) / (pX + LIFT_SMOOTHING_K); // shrink ke q
        const meta = gHeroMeta.get(y)!;
        cobans.push({
          hero_id: y,
          name: meta.name,
          img: meta.img,
          co: coCount,
          lift: p / q,
          confidence: Math.round((coCount / pX) * 100),
        });
      }
      if (cobans.length === 0) continue;
      cobans.sort((a, b) => b.lift - a.lift); // lift desc → meta-ban (lift~1) tenggelam ke bawah
      const meta = gHeroMeta.get(x)!;
      condPicks.push({
        hero_id: x,
        name: meta.name,
        img: meta.img,
        pickCount: pX,
        reliable: pX >= COND_RELIABLE_PX,
        cobans,
      });
    }
    // reliable dulu (biar sinyal kuat di atas), lalu pickCount desc dalam tiap grup
    condPicks.sort((a, b) => Number(b.reliable) - Number(a.reliable) || b.pickCount - a.pickCount);
  }

  // most picked / banned (on-the-fly dari picks_bans sisi tim)
  const pickMap = new Map<number, { name: string; img: string | null; picks: number; wins: number }>();
  const banMap = new Map<number, { name: string; img: string | null; bans: number }>();
  for (const r of teamPb) {
    if (r.is_pick) {
      const p =
        pickMap.get(r.hero_id) ??
        { name: r.hero?.localized_name ?? String(r.hero_id), img: r.hero?.img ?? null, picks: 0, wins: 0 };
      p.picks++;
      if (won.get(r.match_id)) p.wins++;
      pickMap.set(r.hero_id, p);
    } else {
      const b =
        banMap.get(r.hero_id) ??
        { name: r.hero?.localized_name ?? String(r.hero_id), img: r.hero?.img ?? null, bans: 0 };
      b.bans++;
      banMap.set(r.hero_id, b);
    }
  }
  const pickRows = [...pickMap.entries()]
    .map(([hero_id, v]) => ({ hero_id, ...v }))
    .sort((a, b) => b.picks - a.picks)
    .slice(0, 15);
  const banRows = [...banMap.entries()]
    .map(([hero_id, v]) => ({ hero_id, ...v }))
    .sort((a, b) => b.bans - a.bans)
    .slice(0, 15);

  // ban LAWAN pas hadapi tim ini (kebalikan banRows yang = ban tim ini). Scope filter sama.
  // inPool = hero itu ada di pick tim ini (scope ini) → lawan ban andalan mereka.
  const oppBanMap = new Map<number, { name: string; img: string | null; bans: number }>();
  for (const r of allPb) {
    if (r.is_pick || side.get(r.match_id) === (r.team === 0)) continue; // pick / sisi tim ini → skip
    const b =
      oppBanMap.get(r.hero_id) ??
      { name: r.hero?.localized_name ?? String(r.hero_id), img: r.hero?.img ?? null, bans: 0 };
    b.bans++;
    oppBanMap.set(r.hero_id, b);
  }
  const oppBanRows = [...oppBanMap.entries()]
    .map(([hero_id, v]) => ({ hero_id, ...v, inPool: pickMap.has(hero_id) }))
    .sort((a, b) => b.bans - a.bans)
    .slice(0, 15);

  // #3 Last 10 matches (ikut filter, terbaru dulu): vs lawan + W/L + tanggal + hero pick tim + match id.
  const teamHeroesByMatch = new Map<number, { hero_id: number; name: string; img: string | null; position: number | null }[]>();
  for (const r of teamMp) {
    const arr = teamHeroesByMatch.get(r.match_id) ?? [];
    arr.push({
      hero_id: r.hero_id,
      name: r.hero?.localized_name ?? String(r.hero_id),
      img: r.hero?.img ?? null,
      position: r.position,
    });
    teamHeroesByMatch.set(r.match_id, arr);
  }
  const last10 = filtered.slice(0, 10).map((m) => {
    const isRad = side.get(m.match_id) === true;
    const heroes = (teamHeroesByMatch.get(m.match_id) ?? []).slice().sort((a, b) => (a.position ?? 9) - (b.position ?? 9));
    return {
      matchId: m.match_id,
      date: fmtDate(m.start_time),
      win: won.has(m.match_id) ? won.get(m.match_id)! : null,
      oppId: (isRad ? m.dire_team_id : m.radiant_team_id) ?? null,
      oppName: (isRad ? m.dire?.name : m.radiant?.name) ?? "Unknown",
      heroes,
    };
  });

  const initials = teamName.slice(0, 2).toUpperCase();
  const logo = team?.logo_url;
  const scopeLabel = selectedLeague !== null ? leagueMap.get(selectedLeague) : "All tournaments (this patch)";

  const selectedPatchName = patchMap.get(selectedPatch)?.name ?? null;

  return (
    <main className="container" id="pdf-region">
      {/* team-header */}
      <div className="team-header">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="team-logo" src={logo} alt={teamName} width={56} height={56} />
        ) : (
          <div className="team-logo-fallback">{initials}</div>
        )}
        <div>
          <div className="team-title">{teamName}</div>
          <div className="team-meta">
            Record <span className="wr-good">{wins}W</span>–<span className="wr-bad">{losses}L</span>
            {team?.rating ? ` · Elo ${Math.round(team.rating)}` : ""} · {filtered.length} matches · {scopeLabel}
          </div>
        </div>
        <div className="spacer" />
        <PrintButton teamName={teamName} patchName={selectedPatchName} />
      </div>

      <div className="no-pdf">
        <Filters
          teamId={id}
          patches={patches.map((p) => ({ id: p.id, name: p.name }))}
          leagues={leagues}
          selectedPatch={selectedPatch}
          selectedLeague={selectedLeague}
        />
      </div>

      {/* #3 Last 10 matches (ikut filter) */}
      <Section title="Last 10 matches">
      {last10.length === 0 ? (
        <p className="dim">Belum ada match di scope ini.</p>
      ) : (
        <div className="card l10">
          {last10.map((m) => (
            <div key={m.matchId} className="l10-row">
              <span className={`l10-res ${m.win === true ? "wr-good" : m.win === false ? "wr-bad" : "dim"}`}>
                {m.win === null ? "—" : m.win ? "W" : "L"}
              </span>
              <span className="dim l10-date">{m.date}</span>
              <span className="l10-opp">
                vs {m.oppId ? <Link href={`/teams/${m.oppId}`}>{m.oppName}</Link> : m.oppName}
              </span>
              <span className="l10-heroes">
                {m.heroes.map((h) => {
                  const src = heroSrc(h.img);
                  return src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={h.hero_id} className="hero-mini" src={src} alt={h.name} title={h.name} width={34} height={20} />
                  ) : (
                    <span key={h.hero_id} className="dim" title={h.name}>{h.name.slice(0, 3)}</span>
                  );
                })}
              </span>
              <a className="l10-match dim" href={`https://www.dotabuff.com/matches/${m.matchId}`} target="_blank" rel="noreferrer">
                {m.matchId}
              </a>
            </div>
          ))}
        </div>
      )}
      </Section>

      {/* position-pool + hero drill-down (client accordion) */}
      <Section
        title={
          <>
            Hero pool by position{" "}
            <span className="dim" style={{ fontSize: 12, fontWeight: 400 }}>
              · role {rosterSource === "stratz" ? "roster STRATZ" : "derived (Method C)"}
            </span>
          </>
        }
      >
      <PoolAccordion positions={positions} />
      <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>
        Role kanonik per pemain{rosterSource === "stratz" ? " (roster aktif STRATZ)" : " (derivasi net-worth + lane_role — tim ini belum ada di roster STRATZ)"}.
        Klik portrait hero → match tim pick hero itu (scope filter). Standin/sub ada di “+N other player”.
      </div>
      </Section>

      {/* #2 role-duo pairing (GAME winrate) */}
      <Section title="Role-duo combinations">
      <RoleDuos groups={roleDuoGroups} />
      </Section>

      {/* #3 conditional pick → ban — FIX-A: lift, all-time team-wide */}
      <Section
        title={
          <>
            Conditional pick → ban{" "}
            <span className="dim" style={{ fontSize: 12, fontWeight: 400 }}>· all-time, team-wide</span>{" "}
            <span
              className="cpb-help"
              title={`Lift = frekuensi tim ban Y saat pick X ÷ baseline ban Y. >1 = ban spesifik (bukan meta), urut lift desc. Angka: lift× dan count (co/pick). Pool ${condM} match lintas patch (di luar filter di atas). Tampil pick ≥${COND_PICK_GATE}; reliable ≥${COND_RELIABLE_PX}, di bawah = indikatif (n<8, diredam). co ≥${COND_CO_GATE}.`}
            >
              ?
            </span>
          </>
        }
      >
      <CondPickBan picks={condPicks} />
      </Section>

      {/* duo-lane win-lane% (STRATZ) */}
      <Section title="Lane winrate (STRATZ)">
      <div className="card lane-wr">
        {laneAggs.map((l) => (
          <LaneBar key={l.label} agg={l} />
        ))}
        <div className="dim lane-note">
          Win-lane @ ~10min per <a href="https://stratz.com" target="_blank" rel="noreferrer">STRATZ</a>. % = won/(won+lost),
          tie di-exclude (W-T-L tetap ditampilin). Rep core: Safelane=pos1, Mid=pos2, Offlane=pos3. Roamer/no-lane di-skip.
        </div>
      </div>
      </Section>

      {/* #6 lane matchup vs opponent — pakai lane_role (lane asli), lane fisik. current filter scope */}
      <Section title="Lane matchups vs opponent (STRATZ)">
      {laneMatchups.length === 0 ? (
        <p className="dim">Belum ada konfrontasi lane yang jelas di scope ini.</p>
      ) : (
        laneMatchups.map((g) => <LaneMatchupCard key={g.label} group={g} />)
      )}
      <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>
        Berdasar lane ASLI (OpenDota lane_role) + sisi → lane fisik, bukan posisi net-worth. Cuma match di mana
        lane kita beneran ketemu lawan (swap/roam/uncontested di-skip). Hasil lane @~10min (STRATZ). Scope = filter di atas.
      </div>
      </Section>

      {/* sekunder: tabel + chart. "Banned by this team" = ban TIM INI; "Banned by opponents" = ban LAWAN pas hadapi tim ini. */}
      <Section title="Most picked / banned">
      <div className="data-grid">
        <PickTable rows={pickRows} />
        <BanTable rows={banRows} />
        <OppBanTable rows={oppBanRows} totalMatches={filtered.length} />
      </div>
      </Section>

      <Section title="Winrate by side">
      <div className="card">
        <SideBar label="Radiant" wins={sideStat.radW} games={sideStat.radG} />
        <SideBar label="Dire" wins={sideStat.dirW} games={sideStat.dirG} />
      </div>
      </Section>
    </main>
  );
}

function PickTable({
  rows,
}: {
  rows: { hero_id: number; name: string; img: string | null; picks: number; wins: number }[];
}) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Most Picked</th>
          <th className="num">Picks</th>
          <th className="num">Win%</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={3} className="dim">
              No data
            </td>
          </tr>
        ) : (
          rows.map((r, i) => {
            const src = heroSrc(r.img);
            return (
              <tr key={i}>
                <td>
                  <Link className="hero-cell" href={`/heroes/${r.hero_id}`}>
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="hero-mini" src={src} alt="" width={34} height={20} />
                    ) : null}
                    {r.name}
                  </Link>
                </td>
                <td className="num">{r.picks}</td>
                <td className={`num ${wrColor(r.wins, r.picks)}`}>
                  {wrPct(r.wins, r.picks)}% <span className="dim">({r.picks})</span>
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}

function BanTable({ rows }: { rows: { hero_id: number; name: string; img: string | null; bans: number }[] }) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th title="Hero yang tim ini ban">Banned by This Team</th>
          <th className="num">Bans</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={2} className="dim">
              No data
            </td>
          </tr>
        ) : (
          rows.map((r, i) => {
            const src = heroSrc(r.img);
            return (
              <tr key={i}>
                <td>
                  <Link className="hero-cell" href={`/heroes/${r.hero_id}`}>
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="hero-mini" src={src} alt="" width={34} height={20} />
                    ) : null}
                    {r.name}
                  </Link>
                </td>
                <td className="num">{r.bans}</td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}

// ban LAWAN pas hadapi tim ini. ● gold = hero ada di pool pick tim ini (lawan ban andalan).
function OppBanTable({
  rows,
  totalMatches,
}: {
  rows: { hero_id: number; name: string; img: string | null; bans: number; inPool: boolean }[];
  totalMatches: number;
}) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th title="Hero yang LAWAN ban pas hadapi tim ini">Banned by Opponents</th>
          <th className="num" title={`% dari ${totalMatches} match (scope filter)`}>
            Bans <span className="dim">/ {totalMatches}m</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={2} className="dim">
              No data
            </td>
          </tr>
        ) : (
          rows.map((r, i) => {
            const src = heroSrc(r.img);
            const pct = totalMatches ? Math.round((r.bans / totalMatches) * 100) : 0;
            return (
              <tr key={i}>
                <td>
                  <Link className="hero-cell" href={`/heroes/${r.hero_id}`}>
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="hero-mini" src={src} alt="" width={34} height={20} />
                    ) : null}
                    {r.name}
                    {r.inPool ? (
                      <span className="opp-ban-pool" title="Ada di hero pool tim ini — lawan ban andalan">
                        ●
                      </span>
                    ) : null}
                  </Link>
                </td>
                <td className="num">
                  {r.bans}x <span className="dim">({pct}%)</span>
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}

function SideBar({ label, wins, games }: { label: string; wins: number; games: number }) {
  const pct = wrPct(wins, games);
  return (
    <div className="bar-row">
      <span className="label">{label}</span>
      <span className="bar-track">
        <span className="bar-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className={`num ${wrColor(wins, games)}`}>
        {pct}% ({games})
      </span>
    </div>
  );
}

function LaneBar({ agg }: { agg: LaneAgg }) {
  const decided = agg.won + agg.lost; // tie EXCLUDE dari % (tie != kalah)
  const total = decided + agg.tie; // total lane ada outcome (buat sample flag)
  const pct = wrPct(agg.won, decided);
  const low = decided > 0 && decided < 3; // sample kecil → redam
  return (
    <div className="bar-row" style={low ? { opacity: 0.6 } : undefined}>
      <span className="label">{agg.label}</span>
      <span className="bar-track">
        <span className="bar-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className={`num ${decided === 0 ? "dim" : wrColor(agg.won, decided)}`}>
        {decided === 0 ? "—" : `${pct}%`}{" "}
        <span className="dim">
          ({agg.won}-{agg.tie}-{agg.lost}
          {total > 0 ? ` · n${total}` : ""}
          {low ? " · low" : ""})
        </span>
      </span>
    </div>
  );
}

// #6: mini portrait duo (lane matchup)
function MatchupThumbs({ heroes }: { heroes: { name: string; img: string | null }[] }) {
  if (heroes.length === 0) return <span className="dim">—</span>;
  return (
    <span className="lm-duo">
      {heroes.map((h, i) => {
        const src = heroSrc(h.img);
        return src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} className="hero-mini" src={src} alt={h.name} title={h.name} width={34} height={20} />
        ) : (
          <span key={i} className="dim" title={h.name}>
            {h.name.slice(0, 3)}
          </span>
        );
      })}
    </span>
  );
}

function LaneMatchupCard({ group }: { group: LaneMatchupGroup }) {
  const lane = (lr: number | null) =>
    lr === 1
      ? { txt: "Lane W", cls: "lane-won" }
      : lr === -1
        ? { txt: "Lane L", cls: "lane-lost" }
        : lr === 0
          ? { txt: "Lane =", cls: "lane-tie" }
          : { txt: "Lane —", cls: "lane-na" };
  let w = 0;
  let l = 0;
  let t = 0;
  let na = 0;
  for (const m of group.matchups) {
    if (m.laneResult === 1) w++;
    else if (m.laneResult === -1) l++;
    else if (m.laneResult === 0) t++;
    else na++;
  }
  const decided = w + l;
  return (
    <div className="card lm-card">
      <div className="lm-head">
        <b>{group.label}</b>{" "}
        <span className={`dim`}>
          {decided > 0 ? `${wrPct(w, decided)}% lane` : "—"} ({w}-{t}-{l}
          {na ? ` · ${na} n/a` : ""} · {group.matchups.length} match)
        </span>
      </div>
      {group.matchups.length === 0 ? (
        <div className="dim">No lane data in scope.</div>
      ) : (
        <div className="lm-rows">
          {group.matchups.map((m) => {
            const L = lane(m.laneResult);
            return (
              <div key={m.matchId} className="lm-row">
                <span className={`lane-chip ${L.cls}`}>{L.txt}</span>
                <MatchupThumbs heroes={m.ourDuo} />
                <span className="dim lm-vs">vs</span>
                <MatchupThumbs heroes={m.oppDuo} />
                <span className="lm-opp">
                  {m.oppId ? <Link href={`/teams/${m.oppId}`}>{m.oppName}</Link> : m.oppName}
                </span>
                <a
                  className="lm-match dim"
                  href={`https://www.dotabuff.com/matches/${m.matchId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {m.matchId}
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
