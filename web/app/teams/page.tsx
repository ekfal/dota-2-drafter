import { getServerSupabase } from "@/lib/supabase";
import TeamSearch from "./TeamSearch";

// FR-2 entry: grid kartu tim (logo + nama + rekor W-L) + search. Anon read-only.
// W-L dihitung on-the-fly dari matches (radiant_win + sisi). Tiap tim dijamin punya match → no dead-end.
export const dynamic = "force-dynamic";

export interface TeamCard {
  team_id: number;
  name: string | null;
  tag: string | null;
  logo_url: string | null;
  wins: number;
  losses: number;
  matches: number;
}

export default async function TeamsPage() {
  let teams: TeamCard[] = [];
  let error: { message: string } | null = null;

  try {
    const supabase = getServerSupabase();

    const mRes = await supabase
      .from("matches")
      .select("radiant_team_id, dire_team_id, radiant_win")
      .returns<{ radiant_team_id: number | null; dire_team_id: number | null; radiant_win: boolean | null }[]>();
    if (mRes.error) throw new Error(mRes.error.message);

    const rec = new Map<number, { w: number; l: number; g: number }>();
    const bump = (id: number | null, won: boolean | null) => {
      if (!id) return;
      const r = rec.get(id) ?? { w: 0, l: 0, g: 0 };
      r.g++;
      if (won === true) r.w++;
      else if (won === false) r.l++;
      rec.set(id, r);
    };
    for (const m of mRes.data ?? []) {
      bump(m.radiant_team_id, m.radiant_win);
      bump(m.dire_team_id, m.radiant_win === null ? null : !m.radiant_win);
    }
    const ids = [...rec.keys()];

    if (ids.length > 0) {
      const tRes = await supabase
        .from("teams")
        .select("team_id, name, tag, logo_url")
        .in("team_id", ids)
        .returns<{ team_id: number; name: string | null; tag: string | null; logo_url: string | null }[]>();
      if (tRes.error) throw new Error(tRes.error.message);
      teams = (tRes.data ?? [])
        .map((t) => {
          const r = rec.get(t.team_id) ?? { w: 0, l: 0, g: 0 };
          return { ...t, wins: r.w, losses: r.l, matches: r.g };
        })
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
