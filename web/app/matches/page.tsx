import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase";

// Selalu baca fresh dari DB (bukan static prerender).
export const dynamic = "force-dynamic";

interface TeamRef {
  name: string | null;
}
interface LeagueRef {
  name: string | null;
}
interface MatchRow {
  match_id: number;
  start_time: number | null;
  duration: number | null;
  radiant_win: boolean | null;
  league_id: number | null;
  // Embed pakai FK hint (matches punya 2 FK ke teams -> wajib disambiguasi).
  radiant_team: TeamRef | null;
  dire_team: TeamRef | null;
  league: LeagueRef | null;
}

function fmtDate(epoch: number | null): string {
  if (!epoch) return "—";
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

function fmtDuration(sec: number | null): string {
  if (!sec && sec !== 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function winner(r: MatchRow): string {
  if (r.radiant_win === null) return "—"; // belum selesai / unknown
  const side = r.radiant_win ? r.radiant_team : r.dire_team;
  return side?.name ?? (r.radiant_win ? "Radiant" : "Dire");
}

export default async function MatchesPage() {
  let data: MatchRow[] | null = null;
  let error: { message: string } | null = null;

  try {
    const supabase = getServerSupabase();
    const res = await supabase
      .from("matches")
      .select(
        `match_id, start_time, duration, radiant_win, league_id,
         radiant_team:teams!matches_radiant_team_id_fkey(name),
         dire_team:teams!matches_dire_team_id_fkey(name),
         league:leagues!matches_league_id_fkey(name)`
      )
      .order("start_time", { ascending: false, nullsFirst: false })
      .limit(50)
      .returns<MatchRow[]>();
    data = res.data;
    error = res.error;
  } catch (e) {
    error = { message: e instanceof Error ? e.message : String(e) };
  }

  return (
    <main className="container">
      <section className="section-eyebrow">
        <h1>Matches</h1>
        <div className="sub">
          Pro / tournament match terbaru — sumber OpenDota. <Link href="/tournaments">Tournaments &rarr;</Link>
        </div>
      </section>

      {error ? (
        <p>Gagal baca data: {error.message}</p>
      ) : !data || data.length === 0 ? (
        <p>Belum ada match. Jalankan worker ingest dulu.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Match</th>
              <th>League</th>
              <th>Radiant</th>
              <th>Dire</th>
              <th>Winner</th>
              <th className="num">Date</th>
              <th className="num">Dur</th>
            </tr>
          </thead>
          <tbody>
            {data.map((m) => (
              <tr key={m.match_id}>
                <td className="num">
                  <Link href={`/matches/${m.match_id}`}>{m.match_id}</Link>
                </td>
                <td>
                  {m.league_id ? (
                    <Link href={`/tournaments/${m.league_id}`}>{m.league?.name ?? `League ${m.league_id}`}</Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{m.radiant_team?.name ?? "—"}</td>
                <td>{m.dire_team?.name ?? "—"}</td>
                <td>{winner(m)}</td>
                <td className="num">{fmtDate(m.start_time)}</td>
                <td className="num">{fmtDuration(m.duration)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
