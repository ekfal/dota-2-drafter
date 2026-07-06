import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase";

// #4 hero page — dibangun bertahap. Section 1: header + who-plays.
export const dynamic = "force-dynamic";

const CDN = "https://cdn.cloudflare.steamstatic.com";
function heroSrc(img: string | null | undefined): string | null {
  if (!img) return null;
  return img.startsWith("http") ? img : `${CDN}${img}`;
}
const ATTR: Record<string, string> = { str: "Strength", agi: "Agility", int: "Intelligence", all: "Universal" };

interface HeroRow {
  hero_id: number;
  localized_name: string | null;
  primary_attr: string | null;
  img: string | null;
}
interface MpRow {
  match_id: number;
  account_id: number | null;
  is_radiant: boolean;
  win: boolean | null;
  position: number | null;
  player: { name: string | null } | null;
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

export default async function HeroPage({ params }: { params: { hero_id: string } }) {
  const id = Number(params.hero_id);
  if (!Number.isFinite(id)) {
    return (
      <main className="container">
        <p>hero_id tidak valid.</p>
      </main>
    );
  }

  const supabase = getServerSupabase();
  const [heroRes, mpRes, banRes, totalRes] = await Promise.all([
    supabase
      .from("heroes")
      .select("hero_id, localized_name, primary_attr, img")
      .eq("hero_id", id)
      .maybeSingle<HeroRow>(),
    supabase
      .from("match_players")
      .select(
        `match_id, account_id, is_radiant, win, position,
         player:players!match_players_account_id_fkey(name),
         match:matches!match_players_match_id_fkey(
           start_time, radiant_team_id, dire_team_id,
           radiant:teams!matches_radiant_team_id_fkey(name),
           dire:teams!matches_dire_team_id_fkey(name))`
      )
      .eq("hero_id", id)
      .returns<MpRow[]>(),
    supabase
      .from("picks_bans")
      .select("*", { count: "exact", head: true })
      .eq("hero_id", id)
      .eq("is_pick", false),
    supabase.from("matches").select("*", { count: "exact", head: true }),
  ]);

  const hero = heroRes.data;
  const heroName = hero?.localized_name ?? `Hero ${id}`;
  const src = heroSrc(hero?.img);

  // section 2: pick/ban rate + win rate (data kita)
  const mpData = mpRes.data ?? [];
  const picks = mpData.length; // match_players = hero yang di-PICK & main → 1 baris/pick
  const wins = mpData.filter((r) => r.win).length;
  const bans = banRes.count ?? 0;
  const totalMatches = totalRes.count ?? 0;
  const rate = (n: number) => (totalMatches ? Math.round((n / totalMatches) * 100) : 0);
  const winPct = picks ? Math.round((wins / picks) * 100) : 0;
  const winCls = picks === 0 ? "wr-mid" : wins / picks >= 0.55 ? "wr-good" : wins / picks < 0.45 ? "wr-bad" : "wr-mid";

  // section 3: distribusi posisi (match_players.position)
  const POS_LABEL = ["", "Pos 1 · Carry", "Pos 2 · Mid", "Pos 3 · Off", "Pos 4 · Soft sup", "Pos 5 · Hard sup"];
  const posCount = [0, 0, 0, 0, 0, 0];
  for (const r of mpData) if (r.position && r.position >= 1 && r.position <= 5) posCount[r.position]!++;
  const posMax = Math.max(1, ...posCount.slice(1));
  const posDist = [1, 2, 3, 4, 5]
    .map((p) => ({ pos: p, label: POS_LABEL[p]!, games: posCount[p]! }))
    .filter((x) => x.games > 0)
    .sort((a, b) => b.games - a.games);

  // section 4: match terbaru hero ini dipick
  const recent = [...mpData]
    .sort((a, b) => (b.match?.start_time ?? 0) - (a.match?.start_time ?? 0))
    .slice(0, 20)
    .map((r) => {
      const teamId = r.is_radiant ? r.match?.radiant_team_id : r.match?.dire_team_id;
      const teamName = r.is_radiant ? r.match?.radiant?.name : r.match?.dire?.name;
      const oppId = r.is_radiant ? r.match?.dire_team_id : r.match?.radiant_team_id;
      const oppName = r.is_radiant ? r.match?.dire?.name : r.match?.radiant?.name;
      return {
        matchId: r.match_id,
        date: fmtDate(r.match?.start_time),
        win: r.win,
        teamId: teamId ?? null,
        teamName: teamName ?? null,
        oppId: oppId ?? null,
        oppName: oppName ?? null,
      };
    });

  // who-plays: agregasi per player (games desc). Team di-derive dari match (tim yang jalanin
  // hero itu di game itu) — players.team_id kosong di DB, jadi pakai sisi match.
  const byPlayer = new Map<
    number,
    { name: string; games: number; teamVote: Map<number, { name: string; n: number }> }
  >();
  for (const r of mpRes.data ?? []) {
    const key = r.account_id ?? -1;
    const cur =
      byPlayer.get(key) ??
      { name: r.player?.name ?? (r.account_id ? `Player ${r.account_id}` : "Unknown"), games: 0, teamVote: new Map() };
    cur.games++;
    const teamId = r.is_radiant ? r.match?.radiant_team_id : r.match?.dire_team_id;
    const teamName = r.is_radiant ? r.match?.radiant?.name : r.match?.dire?.name;
    if (teamId) {
      const t = cur.teamVote.get(teamId) ?? { name: teamName ?? `Team ${teamId}`, n: 0 };
      t.n++;
      cur.teamVote.set(teamId, t);
    }
    byPlayer.set(key, cur);
  }
  const players = [...byPlayer.entries()]
    .map(([account_id, v]) => {
      // tim yang paling sering (biasanya 1 tim)
      let teamId: number | null = null;
      let teamName: string | null = null;
      let best = 0;
      for (const [tid, t] of v.teamVote) if (t.n > best) ((best = t.n), (teamId = tid), (teamName = t.name));
      return { account_id, name: v.name, games: v.games, teamId, teamName };
    })
    .sort((a, b) => b.games - a.games)
    .slice(0, 20);

  return (
    <main className="container">
      {/* header */}
      <div className="team-header">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="hero-hero-img" src={src} alt={heroName} width={110} height={62} />
        ) : (
          <div className="team-logo-fallback">{heroName.slice(0, 2).toUpperCase()}</div>
        )}
        <div>
          <div className="team-title">{heroName}</div>
          <div className="team-meta">
            {hero?.primary_attr ? ATTR[hero.primary_attr] ?? hero.primary_attr : "—"} · hero_id {id}
          </div>
        </div>
      </div>

      {/* section 2: pick/ban + win rate */}
      <div className="hero-stats">
        <div className="hstat">
          <div className="hstat-v">{rate(picks)}%</div>
          <div className="hstat-l">Pick rate</div>
          <div className="hstat-s dim">{picks} of {totalMatches}</div>
        </div>
        <div className="hstat">
          <div className="hstat-v">{rate(bans)}%</div>
          <div className="hstat-l">Ban rate</div>
          <div className="hstat-s dim">{bans} of {totalMatches}</div>
        </div>
        <div className="hstat">
          <div className="hstat-v">{rate(picks + bans)}%</div>
          <div className="hstat-l">Contest</div>
          <div className="hstat-s dim">{picks + bans} of {totalMatches}</div>
        </div>
        <div className="hstat">
          <div className={`hstat-v ${winCls}`}>{picks ? `${winPct}%` : "—"}</div>
          <div className="hstat-l">Win rate</div>
          <div className="hstat-s dim">{wins}-{picks - wins} ({picks}g)</div>
        </div>
      </div>

      {/* who-plays */}
      <div className="h2">Played by</div>
      {players.length === 0 ? (
        <p className="dim">Belum ada data pick untuk hero ini.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Team</th>
              <th className="num">Games</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.account_id}>
                <td>
                  {p.account_id > 0 ? <Link href={`/players/${p.account_id}`}>{p.name}</Link> : p.name}
                </td>
                <td>
                  {p.teamId ? <Link href={`/teams/${p.teamId}`}>{p.teamName ?? `Team ${p.teamId}`}</Link> : <span className="dim">—</span>}
                </td>
                <td className="num">{p.games}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* section 3: distribusi posisi */}
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
                {p.games} <span className="dim">({Math.round((p.games / picks) * 100)}%)</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* section 4: recent matches dipick */}
      <div className="h2">Recent matches</div>
      {recent.length === 0 ? (
        <p className="dim">Belum ada match.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
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
