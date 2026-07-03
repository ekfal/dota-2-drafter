import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase";
import PrintButton from "./PrintButton";
import Filters from "./Filters";

// FR-2 v2 (dark modern) — team analysis: header + filter(patch/tournament) + position-pool + tabel/chart.
// chunk1: semua data di-scope by patch (mandatory) + tournament (single). Query on-the-fly dari raw
// (matches + match_players + picks_bans), bukan agg table.
export const dynamic = "force-dynamic";

const CDN = "https://cdn.cloudflare.steamstatic.com";
const MATCH_CAP = 80; // batasi match_players/picks_bans < 1000 baris (limit PostgREST)

interface MetaRow {
  match_id: number;
  radiant_team_id: number | null;
  dire_team_id: number | null;
  radiant_win: boolean | null;
  league_id: number | null;
  patch_id: number | null;
  start_time: number | null;
  league: { name: string | null } | null;
  patch: { id: number; name: string | null; start_time: number | null } | null;
}
interface MpRow {
  match_id: number;
  account_id: number | null;
  hero_id: number;
  is_radiant: boolean;
  position: number | null;
  win: boolean | null;
  player: { name: string | null } | null;
  hero: { localized_name: string | null; img: string | null } | null;
}
interface PbRow {
  match_id: number;
  is_pick: boolean;
  hero_id: number;
  team: number; // 0 = radiant, 1 = dire
  hero: { localized_name: string | null; img: string | null } | null;
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

function Portrait({
  heroId,
  name,
  img,
  games,
  wins,
}: {
  heroId: number;
  name: string;
  img: string | null;
  games: number;
  wins: number;
}) {
  const src = heroSrc(img);
  const losses = games - wins;
  return (
    <Link
      href={`/heroes/${heroId}`}
      className={`portrait ${wrClass(wins, games)}`}
      title={`${name} — ${wins}-${losses} (${wrPct(wins, games)}% WR)`}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} width={46} height={26} />
      ) : null}
      <span className="g">
        {wins}-{losses} ({wrPct(wins, games)}%)
      </span>
    </Link>
  );
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
        `match_id, radiant_team_id, dire_team_id, radiant_win, league_id, patch_id, start_time,
         league:leagues!matches_league_id_fkey(name),
         patch:patches!matches_patch_id_fkey(id, name, start_time)`
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
  if (matchIds.length > 0) {
    const [mpRes, pbRes] = await Promise.all([
      supabase
        .from("match_players")
        .select(
          `match_id, account_id, hero_id, is_radiant, position, win,
           player:players!match_players_account_id_fkey(name),
           hero:heroes!match_players_hero_id_fkey(localized_name, img)`
        )
        .in("match_id", matchIds)
        .returns<MpRow[]>(),
      supabase
        .from("picks_bans")
        .select(
          `match_id, is_pick, hero_id, team,
           hero:heroes!picks_bans_hero_id_fkey(localized_name, img)`
        )
        .in("match_id", matchIds)
        .returns<PbRow[]>(),
    ]);
    teamMp = (mpRes.data ?? []).filter((r) => side.get(r.match_id) === r.is_radiant);
    // hanya pick/ban milik sisi tim: (team===0)===isRadiant
    teamPb = (pbRes.data ?? []).filter((r) => side.get(r.match_id) === (r.team === 0));
  }

  // position-pool: per pos → dominant player + hero pool (games desc)
  const positions = [1, 2, 3, 4, 5].map((pos) => {
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
    const heroMap = new Map<number, { name: string; img: string | null; games: number; wins: number }>();
    for (const r of poolRows) {
      const h =
        heroMap.get(r.hero_id) ??
        { name: r.hero?.localized_name ?? String(r.hero_id), img: r.hero?.img ?? null, games: 0, wins: 0 };
      h.games++;
      if (r.win) h.wins++;
      heroMap.set(r.hero_id, h);
    }
    const pool = [...heroMap.entries()].map(([hero_id, v]) => ({ hero_id, ...v })).sort((a, b) => b.games - a.games);

    return {
      pos,
      playerId: domId > 0 ? domId : null,
      playerName: domName,
      pool,
      otherPlayers: Math.max(0, byPlayer.size - 1),
    };
  });

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
  const pickRows = [...pickMap.values()].sort((a, b) => b.picks - a.picks).slice(0, 15);
  const banRows = [...banMap.values()].sort((a, b) => b.bans - a.bans).slice(0, 15);

  const POS_LABEL = ["", "Pos 1 · Carry", "Pos 2 · Mid", "Pos 3 · Off", "Pos 4 · Soft sup", "Pos 5 · Hard sup"];
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

      {/* position-pool (komponen bintang) */}
      <div className="h2">Hero pool by position</div>
      <div className="pos-pool">
        {positions.map((row) => (
          <div key={row.pos} className="pos-row">
            <div className="pos-head">
              <div className="pos-tag">{POS_LABEL[row.pos]}</div>
              <div className="pos-player">
                {row.playerId ? <Link href={`/players/${row.playerId}`}>{row.playerName}</Link> : row.playerName}
              </div>
              {row.otherPlayers > 0 && <div className="pos-sub">+{row.otherPlayers} other player(s)</div>}
            </div>
            <div className="pool">
              {row.pool.length === 0 ? (
                <span className="pool-empty">No data</span>
              ) : (
                row.pool.map((h) => (
                  <Portrait key={h.hero_id} heroId={h.hero_id} name={h.name} img={h.img} games={h.games} wins={h.wins} />
                ))
              )}
            </div>
          </div>
        ))}
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
  rows: { name: string; img: string | null; picks: number; wins: number }[];
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
                  <span className="hero-cell">
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="hero-mini" src={src} alt="" width={34} height={20} />
                    ) : null}
                    {r.name}
                  </span>
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

function BanTable({ rows }: { rows: { name: string; img: string | null; bans: number }[] }) {
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
                  <span className="hero-cell">
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="hero-mini" src={src} alt="" width={34} height={20} />
                    ) : null}
                    {r.name}
                  </span>
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
