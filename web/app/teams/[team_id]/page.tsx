import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase";
import PrintButton from "./PrintButton";
import Filters from "./Filters";
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
  player: { name: string | null } | null;
  hero: { localized_name: string | null; img: string | null } | null;
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
export interface PosData {
  pos: number;
  label: string;
  playerId: number | null;
  playerName: string;
  pool: PoolHero[];
  otherPlayers: number;
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

  const [teamRes, metaRes] = await Promise.all([
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
  ]);

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
  let teamPb: PbRow[] = [];
  let allPb: PbRow[] = [];
  if (matchIds.length > 0) {
    const [mpRes, pbRes] = await Promise.all([
      supabase
        .from("match_players")
        .select(
          `match_id, account_id, hero_id, is_radiant, position, win, lane_result,
           player:players!match_players_account_id_fkey(name),
           hero:heroes!match_players_hero_id_fkey(localized_name, img)`
        )
        .in("match_id", matchIds)
        .returns<MpRow[]>(),
      supabase
        .from("picks_bans")
        .select(
          `match_id, ord, is_pick, hero_id, team,
           hero:heroes!picks_bans_hero_id_fkey(localized_name, img)`
        )
        .in("match_id", matchIds)
        .returns<PbRow[]>(),
    ]);
    teamMp = (mpRes.data ?? []).filter((r) => side.get(r.match_id) === r.is_radiant);
    allPb = pbRes.data ?? [];
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

  // position-pool: per pos → dominant player + hero pool (games desc) + drill-down per hero
  const positions: PosData[] = [1, 2, 3, 4, 5].map((pos) => {
    const rows = teamMp.filter((r) => r.position === pos);
    const byPlayer = new Map<number, { name: string; games: number }>();
    for (const r of rows) {
      const key = r.account_id ?? -1;
      const cur =
        byPlayer.get(key) ??
        { name: r.player?.name ?? (r.account_id ? `Player ${r.account_id}` : "Unknown"), games: 0 };
      cur.games++;
      byPlayer.set(key, cur);
    }
    let domId = -1;
    let domGames = -1;
    let domName = "—";
    for (const [k, v] of byPlayer) if (v.games > domGames) ((domGames = v.games), (domId = k), (domName = v.name));

    const poolRows = rows.filter((r) => (r.account_id ?? -1) === domId);
    const heroMap = new Map<
      number,
      { name: string; img: string | null; games: number; wins: number; matchIds: number[] }
    >();
    for (const r of poolRows) {
      const h =
        heroMap.get(r.hero_id) ??
        { name: r.hero?.localized_name ?? String(r.hero_id), img: r.hero?.img ?? null, games: 0, wins: 0, matchIds: [] };
      h.games++;
      if (r.win) h.wins++;
      h.matchIds.push(r.match_id);
      heroMap.set(r.hero_id, h);
    }
    const pool: PoolHero[] = [...heroMap.entries()]
      .map(([hero_id, v]) => ({
        hero_id,
        name: v.name,
        img: v.img,
        games: v.games,
        wins: v.wins,
        matches: buildDrill(hero_id, v.matchIds),
      }))
      .sort((a, b) => b.games - a.games);

    return {
      pos,
      label: POS_LABEL[pos]!,
      playerId: domId > 0 ? domId : null,
      playerName: domName,
      pool,
      otherPlayers: Math.max(0, byPlayer.size - 1),
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
  const roleDuoGroups: RoleDuoGroup[] = [
    duoGroup("Safelane · 1+5", 1, 5),
    duoGroup("Offlane · 3+4", 3, 4),
    duoGroup("Mid · 2+4", 2, 4),
    duoGroup("Mid · 2+5", 2, 5),
  ];

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

  const initials = teamName.slice(0, 2).toUpperCase();
  const logo = team?.logo_url;
  const scopeLabel = selectedLeague !== null ? leagueMap.get(selectedLeague) : "All tournaments (this patch)";

  return (
    <main className="container">
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
        <PrintButton />
      </div>

      <Filters
        teamId={id}
        patches={patches.map((p) => ({ id: p.id, name: p.name }))}
        leagues={leagues}
        selectedPatch={selectedPatch}
        selectedLeague={selectedLeague}
      />

      {/* position-pool + hero drill-down (client accordion) */}
      <div className="h2">Hero pool by position</div>
      <PoolAccordion positions={positions} />
      <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>
        Klik portrait hero → lihat match tim ini pick hero itu (scope filter ini).
      </div>

      {/* #2 role-duo pairing (GAME winrate) */}
      <div className="h2">Role-duo combinations</div>
      <RoleDuos groups={roleDuoGroups} />

      {/* #3 conditional pick → ban — FIX-A: lift, all-time team-wide */}
      <div className="h2">
        Conditional pick → ban{" "}
        <span className="dim" style={{ fontSize: 12, fontWeight: 400 }}>· all-time, team-wide</span>
      </div>
      <CondPickBan picks={condPicks} />
      <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>
        Lift = seberapa sering tim ban hero Y saat pick X vs baseline ban Y. Lift &gt;1 = ban spesifik (bukan
        meta). Pool: {condM} match tim <b>lintas patch — di luar filter di atas</b>. Tampil pick X ≥
        {COND_PICK_GATE}; pick X ≥{COND_RELIABLE_PX} = reliable, {COND_PICK_GATE}–{COND_RELIABLE_PX - 1} =
        indikatif (di-redam). co ≥{COND_CO_GATE}.
      </div>

      {/* duo-lane win-lane% (STRATZ) */}
      <div className="h2">Lane winrate (STRATZ)</div>
      <div className="card lane-wr">
        {laneAggs.map((l) => (
          <LaneBar key={l.label} agg={l} />
        ))}
        <div className="dim lane-note">
          Win-lane @ ~10min per <a href="https://stratz.com" target="_blank" rel="noreferrer">STRATZ</a>. % = won/(won+lost),
          tie di-exclude (W-T-L tetap ditampilin). Rep core: Safelane=pos1, Mid=pos2, Offlane=pos3. Roamer/no-lane di-skip.
        </div>
      </div>

      {/* sekunder: tabel + chart */}
      <div className="h2">Most picked / banned</div>
      <div className="data-grid">
        <PickTable rows={pickRows} />
        <BanTable rows={banRows} />
      </div>

      <div className="h2">Winrate by side</div>
      <div className="card">
        <SideBar label="Radiant" wins={sideStat.radW} games={sideStat.radG} />
        <SideBar label="Dire" wins={sideStat.dirW} games={sideStat.dirG} />
      </div>
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
          <th>Most Banned</th>
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
