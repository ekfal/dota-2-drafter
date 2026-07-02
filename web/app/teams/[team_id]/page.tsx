import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase";
import PrintButton from "./PrintButton";

// FR-2 v2 (dark modern) — team analysis: header + position-pool (portrait per pos) + tabel/chart sekunder.
export const dynamic = "force-dynamic";

const CDN = "https://cdn.cloudflare.steamstatic.com";
const MATCH_CAP = 80; // batasi recent match biar match_players < 1000 (limit PostgREST)

interface MatchRow {
  match_id: number;
  radiant_team_id: number | null;
  dire_team_id: number | null;
  radiant_win: boolean | null;
  league_id: number | null;
  start_time: number | null;
  league: { name: string | null } | null;
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
interface StatRow {
  picks: number;
  pick_wins: number;
  bans: number;
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
  return (
    <Link
      href={`/heroes/${heroId}`}
      className={`portrait ${wrClass(wins, games)}`}
      title={`${name} — ${wrPct(wins, games)}% WR (${games} games)`}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} width={46} height={26} />
      ) : null}
      <span className="g">{games}</span>
    </Link>
  );
}

export default async function TeamPage({ params }: { params: { team_id: string } }) {
  const id = Number(params.team_id);

  if (!Number.isFinite(id)) {
    return (
      <main className="container">
        <p>team_id tidak valid.</p>
      </main>
    );
  }

  const supabase = getServerSupabase();

  const [teamRes, matchRes, pickRes, banRes] = await Promise.all([
    supabase.from("teams").select("name, rating, logo_url").eq("team_id", id).maybeSingle<{
      name: string | null;
      rating: number | null;
      logo_url: string | null;
    }>(),
    supabase
      .from("matches")
      .select(
        `match_id, radiant_team_id, dire_team_id, radiant_win, league_id, start_time,
         league:leagues!matches_league_id_fkey(name)`
      )
      .or(`radiant_team_id.eq.${id},dire_team_id.eq.${id}`)
      .order("start_time", { ascending: false })
      .limit(MATCH_CAP)
      .returns<MatchRow[]>(),
    supabase
      .from("team_hero_stats")
      .select(`picks, pick_wins, bans, hero:heroes!team_hero_stats_hero_id_fkey(localized_name, img)`)
      .eq("team_id", id)
      .gt("picks", 0)
      .order("picks", { ascending: false })
      .limit(15)
      .returns<StatRow[]>(),
    supabase
      .from("team_hero_stats")
      .select(`picks, pick_wins, bans, hero:heroes!team_hero_stats_hero_id_fkey(localized_name, img)`)
      .eq("team_id", id)
      .gt("bans", 0)
      .order("bans", { ascending: false })
      .limit(15)
      .returns<StatRow[]>(),
  ]);

  const team = teamRes.data;
  const matches = matchRes.data ?? [];
  const teamName = team?.name ?? `Team ${id}`;

  // sisi tim per match + rekor + side winrate
  const side = new Map<number, boolean>(); // match_id -> isRadiant(team)
  let wins = 0;
  let losses = 0;
  const sideStat = { radG: 0, radW: 0, dirG: 0, dirW: 0 };
  for (const m of matches) {
    const isRad = m.radiant_team_id === id;
    side.set(m.match_id, isRad);
    if (m.radiant_win !== null) {
      const won = (isRad && m.radiant_win) || (!isRad && !m.radiant_win);
      if (won) wins++;
      else losses++;
      if (isRad) {
        sideStat.radG++;
        if (won) sideStat.radW++;
      } else {
        sideStat.dirG++;
        if (won) sideStat.dirW++;
      }
    }
  }

  // chips turnamen (distinct)
  const leagueMap = new Map<number, string>();
  for (const m of matches) if (m.league_id) leagueMap.set(m.league_id, m.league?.name ?? `League ${m.league_id}`);

  // match_players tim (filter sisi)
  const matchIds = matches.map((m) => m.match_id);
  let teamMp: MpRow[] = [];
  if (matchIds.length > 0) {
    const mpRes = await supabase
      .from("match_players")
      .select(
        `match_id, account_id, hero_id, is_radiant, position, win,
         player:players!match_players_account_id_fkey(name),
         hero:heroes!match_players_hero_id_fkey(localized_name, img)`
      )
      .in("match_id", matchIds)
      .returns<MpRow[]>();
    teamMp = (mpRes.data ?? []).filter((r) => side.get(r.match_id) === r.is_radiant);
  }

  // position-pool: per pos → dominant player + hero pool (games desc)
  const positions = [1, 2, 3, 4, 5].map((pos) => {
    const rows = teamMp.filter((r) => r.position === pos);
    // dominant player (games terbanyak di pos ini)
    const byPlayer = new Map<number, { name: string; games: number }>();
    for (const r of rows) {
      const key = r.account_id ?? -1;
      const cur = byPlayer.get(key) ?? { name: r.player?.name ?? (r.account_id ? `Player ${r.account_id}` : "Unknown"), games: 0 };
      cur.games++;
      byPlayer.set(key, cur);
    }
    let domId = -1;
    let domGames = -1;
    let domName = "—";
    for (const [k, v] of byPlayer) if (v.games > domGames) ((domGames = v.games), (domId = k), (domName = v.name));

    // pool = hero dominant player di pos ini
    const poolRows = rows.filter((r) => (r.account_id ?? -1) === domId);
    const heroMap = new Map<number, { name: string; img: string | null; games: number; wins: number }>();
    for (const r of poolRows) {
      const h = heroMap.get(r.hero_id) ?? { name: r.hero?.localized_name ?? String(r.hero_id), img: r.hero?.img ?? null, games: 0, wins: 0 };
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

  const POS_LABEL = ["", "Pos 1 · Carry", "Pos 2 · Mid", "Pos 3 · Off", "Pos 4 · Soft sup", "Pos 5 · Hard sup"];
  const initials = teamName.slice(0, 2).toUpperCase();
  const logo = team?.logo_url;

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
            {team?.rating ? ` · Elo ${Math.round(team.rating)}` : ""} · {matches.length} recent matches
          </div>
        </div>
        <div className="spacer" />
        <PrintButton />
      </div>

      {leagueMap.size > 0 && (
        <div className="chips">
          {[...leagueMap.entries()].map(([lid, name]) => (
            <Link key={lid} href={`/tournaments/${lid}`} className="chip">
              {name}
            </Link>
          ))}
        </div>
      )}

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
        <StatTable title="Most Picked" rows={pickRes.data ?? []} mode="pick" />
        <StatTable title="Most Banned" rows={banRes.data ?? []} mode="ban" />
      </div>

      <div className="h2">Winrate by side</div>
      <div className="card">
        <SideBar label="Radiant" wins={sideStat.radW} games={sideStat.radG} />
        <SideBar label="Dire" wins={sideStat.dirW} games={sideStat.dirG} />
      </div>
    </main>
  );
}

function StatTable({ title, rows, mode }: { title: string; rows: StatRow[]; mode: "pick" | "ban" }) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>{title}</th>
          <th className="num">{mode === "pick" ? "Picks" : "Bans"}</th>
          {mode === "pick" && <th className="num">Win%</th>}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={mode === "pick" ? 3 : 2} className="dim">
              No data
            </td>
          </tr>
        ) : (
          rows.map((r, i) => {
            const src = heroSrc(r.hero?.img);
            const n = mode === "pick" ? r.picks : r.bans;
            return (
              <tr key={i}>
                <td>
                  <span className="hero-cell">
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="hero-mini" src={src} alt="" width={34} height={20} />
                    ) : null}
                    {r.hero?.localized_name ?? "—"}
                  </span>
                </td>
                <td className="num">{n}</td>
                {mode === "pick" && (
                  <td className={`num ${wrColor(r.pick_wins, r.picks)}`}>
                    {wrPct(r.pick_wins, r.picks)}% <span className="dim">({r.picks})</span>
                  </td>
                )}
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
