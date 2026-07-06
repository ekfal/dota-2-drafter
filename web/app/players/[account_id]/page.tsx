import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase";

// #5 player page /players/[account_id] — mirror #4 (hero page).
// Team di-derive dari match (sisi tim yg pemain jalanin per game) — players.team_id kosong di DB.
// is_pro juga kosong → indikator pro TIDAK ditampilkan (jangan nebak). Lihat known-issue di DESIGN/laporan.
export const dynamic = "force-dynamic";

const CDN = "https://cdn.cloudflare.steamstatic.com";
function heroSrc(img: string | null | undefined): string | null {
  if (!img) return null;
  return img.startsWith("http") ? img : `${CDN}${img}`;
}

interface PlayerRow {
  account_id: number;
  name: string | null;
}
interface MpRow {
  match_id: number;
  hero_id: number;
  is_radiant: boolean;
  win: boolean | null;
  position: number | null;
  lane_result: number | null; // STRATZ: 1 won, 0 tie, -1 lost, null roam/no-lane
  hero: { localized_name: string | null; img: string | null } | null;
  match: {
    start_time: number | null;
    radiant_team_id: number | null;
    dire_team_id: number | null;
    radiant: { name: string | null } | null;
    dire: { name: string | null } | null;
  } | null;
}

function fmtDate(epoch: number | null | undefined): string {
  if (!epoch) return "—";
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}
function wrPct(wins: number, games: number): number {
  return games ? Math.round((wins / games) * 100) : 0;
}
function wrColor(wins: number, games: number): string {
  if (games === 0) return "wr-mid";
  const wr = wins / games;
  return wr >= 0.55 ? "wr-good" : wr < 0.45 ? "wr-bad" : "wr-mid";
}

export default async function PlayerPage({ params }: { params: { account_id: string } }) {
  const id = Number(params.account_id);
  if (!Number.isFinite(id)) {
    return (
      <main className="container">
        <p>account_id tidak valid.</p>
      </main>
    );
  }

  const supabase = getServerSupabase();
  const [playerRes, mpRes] = await Promise.all([
    supabase.from("players").select("account_id, name").eq("account_id", id).maybeSingle<PlayerRow>(),
    supabase
      .from("match_players")
      .select(
        `match_id, hero_id, is_radiant, win, position, lane_result,
         hero:heroes!match_players_hero_id_fkey(localized_name, img),
         match:matches!match_players_match_id_fkey(
           start_time, radiant_team_id, dire_team_id,
           radiant:teams!matches_radiant_team_id_fkey(name),
           dire:teams!matches_dire_team_id_fkey(name))`
      )
      .eq("account_id", id)
      .returns<MpRow[]>(),
  ]);

  const mpData = mpRes.data ?? [];
  const playerName = playerRes.data?.name ?? (mpData.length ? `Player ${id}` : `Player ${id}`);

  // team di-derive dari match: sisi yg pemain jalanin per game, vote terbanyak (biasanya 1 tim).
  const teamVote = new Map<number, { name: string; n: number }>();
  for (const r of mpData) {
    const teamId = r.is_radiant ? r.match?.radiant_team_id : r.match?.dire_team_id;
    const teamName = r.is_radiant ? r.match?.radiant?.name : r.match?.dire?.name;
    if (teamId) {
      const t = teamVote.get(teamId) ?? { name: teamName ?? `Team ${teamId}`, n: 0 };
      t.n++;
      teamVote.set(teamId, t);
    }
  }
  let teamId: number | null = null;
  let teamName: string | null = null;
  let best = 0;
  for (const [tid, t] of teamVote) if (t.n > best) ((best = t.n), (teamId = tid), (teamName = t.name));

  // stat overall
  const games = mpData.length;
  const wins = mpData.filter((r) => r.win === true).length;
  const winPct = wrPct(wins, games);

  // lane winrate (STRATZ lane_result) — won/(won+lost), tie exclude.
  let lWon = 0;
  let lTie = 0;
  let lLost = 0;
  for (const r of mpData) {
    if (r.lane_result === 1) lWon++;
    else if (r.lane_result === 0) lTie++;
    else if (r.lane_result === -1) lLost++;
  }
  const laneDecided = lWon + lLost;
  const lanePct = wrPct(lWon, laneDecided);

  // hero pool: per hero games/wins (games desc).
  const heroMap = new Map<number, { name: string; img: string | null; games: number; wins: number }>();
  for (const r of mpData) {
    const h =
      heroMap.get(r.hero_id) ??
      { name: r.hero?.localized_name ?? String(r.hero_id), img: r.hero?.img ?? null, games: 0, wins: 0 };
    h.games++;
    if (r.win === true) h.wins++;
    heroMap.set(r.hero_id, h);
  }
  const heroPool = [...heroMap.entries()]
    .map(([hero_id, v]) => ({ hero_id, ...v }))
    .sort((a, b) => b.games - a.games || b.wins - a.wins);
  const distinctHeroes = heroPool.length;

  // distribusi posisi
  const POS_LABEL = ["", "Pos 1 · Carry", "Pos 2 · Mid", "Pos 3 · Off", "Pos 4 · Soft sup", "Pos 5 · Hard sup"];
  const posCount = [0, 0, 0, 0, 0, 0];
  for (const r of mpData) if (r.position && r.position >= 1 && r.position <= 5) posCount[r.position]!++;
  const posMax = Math.max(1, ...posCount.slice(1));
  const posDist = [1, 2, 3, 4, 5]
    .map((p) => ({ pos: p, label: POS_LABEL[p]!, games: posCount[p]! }))
    .filter((x) => x.games > 0)
    .sort((a, b) => b.games - a.games);

  // recent matches dipick
  const recent = [...mpData]
    .sort((a, b) => (b.match?.start_time ?? 0) - (a.match?.start_time ?? 0))
    .slice(0, 20)
    .map((r) => {
      const tName = r.is_radiant ? r.match?.radiant?.name : r.match?.dire?.name;
      const tId = r.is_radiant ? r.match?.radiant_team_id : r.match?.dire_team_id;
      const oppId = r.is_radiant ? r.match?.dire_team_id : r.match?.radiant_team_id;
      const oppName = r.is_radiant ? r.match?.dire?.name : r.match?.radiant?.name;
      return {
        matchId: r.match_id,
        date: fmtDate(r.match?.start_time),
        win: r.win,
        heroId: r.hero_id,
        heroName: r.hero?.localized_name ?? String(r.hero_id),
        heroImg: heroSrc(r.hero?.img),
        teamId: tId ?? null,
        teamName: tName ?? null,
        oppId: oppId ?? null,
        oppName: oppName ?? null,
        laneResult: r.lane_result,
      };
    });

  const winCls = games === 0 ? "wr-mid" : wins / games >= 0.55 ? "wr-good" : wins / games < 0.45 ? "wr-bad" : "wr-mid";

  return (
    <main className="container">
      {/* header — NO pro indicator (is_pro kosong di DB) */}
      <div className="team-header">
        <div className="team-logo-fallback">{playerName.slice(0, 2).toUpperCase()}</div>
        <div>
          <div className="team-title">{playerName}</div>
          <div className="team-meta">
            {teamId ? (
              <Link href={`/teams/${teamId}`}>{teamName ?? `Team ${teamId}`}</Link>
            ) : (
              <span className="dim">No team</span>
            )}{" "}
            · account_id {id}
          </div>
        </div>
      </div>

      {/* stat tiles */}
      <div className="hero-stats">
        <div className="hstat">
          <div className="hstat-v">{games}</div>
          <div className="hstat-l">Games</div>
          <div className="hstat-s dim">picked & played</div>
        </div>
        <div className="hstat">
          <div className={`hstat-v ${winCls}`}>{games ? `${winPct}%` : "—"}</div>
          <div className="hstat-l">Win rate</div>
          <div className="hstat-s dim">{wins}-{games - wins} ({games}g)</div>
        </div>
        <div className="hstat">
          <div className="hstat-v">{distinctHeroes}</div>
          <div className="hstat-l">Heroes</div>
          <div className="hstat-s dim">distinct picked</div>
        </div>
        <div className="hstat">
          <div className={`hstat-v ${laneDecided === 0 ? "wr-mid" : wrColor(lWon, laneDecided)}`}>
            {laneDecided === 0 ? "—" : `${lanePct}%`}
          </div>
          <div className="hstat-l">Lane winrate</div>
          <div className="hstat-s dim">
            {lWon}-{lTie}-{lLost}
            {laneDecided + lTie > 0 ? ` · n${laneDecided + lTie}` : ""}
          </div>
        </div>
      </div>

      {/* hero pool */}
      <div className="h2">Hero pool</div>
      {heroPool.length === 0 ? (
        <p className="dim">Belum ada data pick untuk pemain ini.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Hero</th>
              <th className="num">Games</th>
              <th className="num">Win%</th>
            </tr>
          </thead>
          <tbody>
            {heroPool.map((h) => {
              const src = heroSrc(h.img);
              return (
                <tr key={h.hero_id}>
                  <td>
                    <Link className="hero-cell" href={`/heroes/${h.hero_id}`}>
                      {src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="hero-mini" src={src} alt="" width={34} height={20} />
                      ) : null}
                      {h.name}
                    </Link>
                  </td>
                  <td className="num">{h.games}</td>
                  <td className={`num ${wrColor(h.wins, h.games)}`}>
                    {wrPct(h.wins, h.games)}% <span className="dim">({h.games})</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* distribusi posisi */}
      <div className="h2">Usual position</div>
      {posDist.length === 0 ? (
        <p className="dim">Belum ada data posisi.</p>
      ) : (
        <div className="card lane-wr">
          {posDist.map((p) => (
            <div className="bar-row" key={p.pos}>
              <span className="label">{p.label}</span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${Math.round((p.games / posMax) * 100)}%` }} />
              </span>
              <span className="num">
                {p.games} <span className="dim">({Math.round((p.games / games) * 100)}%)</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* recent matches */}
      <div className="h2">Recent matches</div>
      {recent.length === 0 ? (
        <p className="dim">Belum ada match.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Hero</th>
              <th>Team</th>
              <th>Opponent</th>
              <th className="num">Result</th>
              <th className="num">Match</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((m) => (
              <tr key={m.matchId}>
                <td className="dim">{m.date}</td>
                <td>
                  <Link className="hero-cell" href={`/heroes/${m.heroId}`}>
                    {m.heroImg ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="hero-mini" src={m.heroImg} alt="" width={34} height={20} />
                    ) : null}
                    {m.heroName}
                  </Link>
                </td>
                <td>
                  {m.teamId ? <Link href={`/teams/${m.teamId}`}>{m.teamName ?? `Team ${m.teamId}`}</Link> : <span className="dim">—</span>}
                </td>
                <td>
                  {m.oppId ? <Link href={`/teams/${m.oppId}`}>{m.oppName ?? `Team ${m.oppId}`}</Link> : <span className="dim">—</span>}
                </td>
                <td className={`num ${m.win === true ? "wr-good" : m.win === false ? "wr-bad" : "dim"}`}>
                  {m.win === null ? "—" : m.win ? "W" : "L"}
                </td>
                <td className="num">
                  <a href={`https://www.dotabuff.com/matches/${m.matchId}`} target="_blank" rel="noreferrer">
                    {m.matchId}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
