import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase";

// FR-2 entry: list team yang punya agregat. Anon read-only.
export const dynamic = "force-dynamic";

interface TeamRow {
  team_id: number;
  name: string | null;
}

export default async function TeamsPage() {
  let teams: TeamRow[] = [];
  let error: { message: string } | null = null;

  try {
    const supabase = getServerSupabase();
    const statRes = await supabase
      .from("team_hero_stats")
      .select("team_id")
      .returns<{ team_id: number }[]>();
    if (statRes.error) throw new Error(statRes.error.message);
    const ids = [...new Set((statRes.data ?? []).map((r) => r.team_id))];

    if (ids.length > 0) {
      const tRes = await supabase
        .from("teams")
        .select("team_id, name")
        .in("team_id", ids)
        .order("name")
        .returns<TeamRow[]>();
      if (tRes.error) throw new Error(tRes.error.message);
      teams = tRes.data ?? [];
    }
  } catch (e) {
    error = { message: e instanceof Error ? e.message : String(e) };
  }

  return (
    <main className="container">
      <section className="section-eyebrow">
        <h1>Teams</h1>
        <div className="sub">Agregat pick / ban per tim.</div>
      </section>

      {error ? (
        <p>Gagal baca data: {error.message}</p>
      ) : teams.length === 0 ? (
        <p>Belum ada agregat. Jalankan job aggregate dulu.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Team</th>
              <th className="num">ID</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.team_id}>
                <td>
                  <Link href={`/teams/${t.team_id}`}>{t.name ?? `Team ${t.team_id}`}</Link>
                </td>
                <td className="num">{t.team_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
