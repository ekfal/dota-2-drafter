import { getServerSupabase } from "@/lib/supabase";
import TeamSearch from "./TeamSearch";

// FR-2 entry: list tim yang PUNYA match (>= MIN_MATCHES) + search. Anon read-only.
// Sumber = tally match count dari `matches` (bukan team_hero_stats) → tiap tim di list
// dijamin punya halaman berisi (no dead-end). Urut match count desc → tim pro naik, tim tipis turun.
export const dynamic = "force-dynamic";

const MIN_MATCHES = 1; // tim tampil kalau punya >= ini match ter-tag

interface TeamRow {
  team_id: number;
  name: string | null;
  tag: string | null;
  matches: number;
}

export default async function TeamsPage() {
  let teams: TeamRow[] = [];
  let error: { message: string } | null = null;

  try {
    const supabase = getServerSupabase();

    // tally match per tim dari matches (radiant/dire)
    const mRes = await supabase
      .from("matches")
      .select("radiant_team_id, dire_team_id")
      .returns<{ radiant_team_id: number | null; dire_team_id: number | null }[]>();
    if (mRes.error) throw new Error(mRes.error.message);

    const count = new Map<number, number>();
    for (const m of mRes.data ?? []) {
      for (const t of [m.radiant_team_id, m.dire_team_id]) {
        if (t) count.set(t, (count.get(t) ?? 0) + 1);
      }
    }
    const ids = [...count.entries()].filter(([, n]) => n >= MIN_MATCHES).map(([id]) => id);

    if (ids.length > 0) {
      const tRes = await supabase
        .from("teams")
        .select("team_id, name, tag")
        .in("team_id", ids)
        .returns<{ team_id: number; name: string | null; tag: string | null }[]>();
      if (tRes.error) throw new Error(tRes.error.message);
      teams = (tRes.data ?? [])
        .map((t) => ({ ...t, matches: count.get(t.team_id) ?? 0 }))
        .sort((a, b) => b.matches - a.matches || (a.name ?? "").localeCompare(b.name ?? ""));
    }
  } catch (e) {
    error = { message: e instanceof Error ? e.message : String(e) };
  }

  return (
    <main className="container">
      <section className="section-eyebrow">
        <h1>Teams</h1>
        <div className="sub">Tim dengan match pro di DB. Urut by jumlah match.</div>
      </section>

      {error ? (
        <p>Gagal baca data: {error.message}</p>
      ) : teams.length === 0 ? (
        <p>Belum ada match. Jalankan job ingest dulu.</p>
      ) : (
        <TeamSearch teams={teams} />
      )}
    </main>
  );
}
