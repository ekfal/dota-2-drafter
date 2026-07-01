import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase";

// FR-1 entry: list turnamen yang punya data agregat. Anon read-only.
export const dynamic = "force-dynamic";

interface LeagueRow {
  league_id: number;
  name: string | null;
}

export default async function TournamentsPage() {
  let leagues: LeagueRow[] = [];
  let error: { message: string } | null = null;

  try {
    const supabase = getServerSupabase();
    // League yang punya baris di tournament_hero_stats (ada data agregat).
    const statRes = await supabase
      .from("tournament_hero_stats")
      .select("league_id")
      .returns<{ league_id: number }[]>();
    if (statRes.error) throw new Error(statRes.error.message);
    const ids = [...new Set((statRes.data ?? []).map((r) => r.league_id))];

    if (ids.length > 0) {
      const lRes = await supabase
        .from("leagues")
        .select("league_id, name")
        .in("league_id", ids)
        .order("name")
        .returns<LeagueRow[]>();
      if (lRes.error) throw new Error(lRes.error.message);
      leagues = lRes.data ?? [];
    }
  } catch (e) {
    error = { message: e instanceof Error ? e.message : String(e) };
  }

  return (
    <main className="container">
      <section className="section-eyebrow">
        <h1>Tournaments</h1>
        <div className="sub">Agregat pick / ban / contest per turnamen.</div>
      </section>

      {error ? (
        <p>Gagal baca data: {error.message}</p>
      ) : leagues.length === 0 ? (
        <p>Belum ada agregat. Jalankan job aggregate dulu.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>League</th>
              <th className="num">ID</th>
            </tr>
          </thead>
          <tbody>
            {leagues.map((l) => (
              <tr key={l.league_id}>
                <td>
                  <Link href={`/tournaments/${l.league_id}`}>{l.name ?? `League ${l.league_id}`}</Link>
                </td>
                <td className="num">{l.league_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
