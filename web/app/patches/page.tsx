import Link from "next/link";
import { getServerSupabase, pageAll } from "@/lib/supabase";

// #2 patches list: patch + tanggal rilis + jumlah match + turnamen di patch itu (link → tournament).
export const dynamic = "force-dynamic";

interface PatchRow {
  id: number;
  name: string;
  start_time: number;
  matches: number;
  leagues: { league_id: number; name: string }[];
}

function fmtDate(epoch: number | null | undefined): string {
  if (!epoch) return "—";
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

export default async function PatchesPage() {
  let rows: PatchRow[] = [];
  let error: { message: string } | null = null;

  try {
    const supabase = getServerSupabase();
    const [pRes, matchesAll] = await Promise.all([
      supabase
        .from("patches")
        .select("id, name, start_time")
        .order("start_time", { ascending: false })
        .returns<{ id: number; name: string; start_time: number }[]>(),
      pageAll<{ patch_id: number | null; league_id: number | null }>((f, t) =>
        supabase
          .from("matches")
          .select("patch_id, league_id")
          .range(f, t)
          .returns<{ patch_id: number | null; league_id: number | null }[]>()
      ),
    ]);
    if (pRes.error) throw new Error(pRes.error.message);

    const cnt = new Map<number, number>();
    const leaguesByPatch = new Map<number, Set<number>>();
    for (const m of matchesAll) {
      if (m.patch_id == null) continue;
      cnt.set(m.patch_id, (cnt.get(m.patch_id) ?? 0) + 1);
      if (m.league_id) {
        const s = leaguesByPatch.get(m.patch_id) ?? new Set<number>();
        s.add(m.league_id);
        leaguesByPatch.set(m.patch_id, s);
      }
    }
    const allLeagueIds = [...new Set([...leaguesByPatch.values()].flatMap((s) => [...s]))];
    let nameById = new Map<number, string | null>();
    if (allLeagueIds.length > 0) {
      const lRes = await supabase
        .from("leagues")
        .select("league_id, name")
        .in("league_id", allLeagueIds)
        .returns<{ league_id: number; name: string | null }[]>();
      nameById = new Map((lRes.data ?? []).map((l) => [l.league_id, l.name]));
    }

    rows = (pRes.data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      start_time: p.start_time,
      matches: cnt.get(p.id) ?? 0,
      leagues: [...(leaguesByPatch.get(p.id) ?? [])].map((lid) => ({
        league_id: lid,
        name: nameById.get(lid) ?? `League ${lid}`,
      })),
    }));
  } catch (e) {
    error = { message: e instanceof Error ? e.message : String(e) };
  }

  return (
    <main className="container">
      <section className="section-eyebrow">
        <h1>Patches</h1>
        <div className="sub">Patch pro yang tercatat, terbaru dulu. Klik turnamen → halaman turnamen.</div>
      </section>

      {error ? (
        <p>Gagal baca data: {error.message}</p>
      ) : rows.length === 0 ? (
        <p>Belum ada patch.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Patch</th>
              <th>Rilis</th>
              <th className="num">Matches</th>
              <th>Tournaments</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className="dim">{fmtDate(p.start_time)}</td>
                <td className="num">{p.matches}</td>
                <td>
                  {p.leagues.length === 0 ? (
                    <span className="dim">—</span>
                  ) : (
                    <span className="patch-leagues">
                      {p.leagues.slice(0, 4).map((l) => (
                        <Link key={l.league_id} href={`/tournaments/${l.league_id}`} className="chip">
                          {l.name}
                        </Link>
                      ))}
                      {p.leagues.length > 4 ? <span className="dim">+{p.leagues.length - 4}</span> : null}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
