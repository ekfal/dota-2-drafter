import Link from "next/link";
import { getServerSupabase, pageAll } from "@/lib/supabase";

// FR-1 entry: list turnamen (nama + tanggal + jumlah match). Tanggal di-derive dari matches
// (leagues tak simpan tanggal). Cuma league yang PUNYA match → no dead-end. Anon read-only.
export const dynamic = "force-dynamic";

interface Row {
  league_id: number;
  name: string | null;
  matches: number;
  first: number; // epoch match paling awal
  last: number; // epoch match paling akhir
}

function fmtDate(epoch: number): string {
  if (!epoch) return "—";
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

export default async function TournamentsPage() {
  let rows: Row[] = [];
  let error: { message: string } | null = null;

  try {
    const supabase = getServerSupabase();
    const matchesAll = await pageAll<{ league_id: number | null; start_time: number | null }>((f, t) =>
      supabase
        .from("matches")
        .select("league_id, start_time")
        .range(f, t)
        .returns<{ league_id: number | null; start_time: number | null }[]>()
    );

    const agg = new Map<number, { matches: number; first: number; last: number }>();
    for (const m of matchesAll) {
      if (!m.league_id) continue;
      const a = agg.get(m.league_id) ?? { matches: 0, first: Infinity, last: 0 };
      a.matches++;
      const st = m.start_time ?? 0;
      if (st) {
        if (st < a.first) a.first = st;
        if (st > a.last) a.last = st;
      }
      agg.set(m.league_id, a);
    }
    const ids = [...agg.keys()];

    if (ids.length > 0) {
      const lRes = await supabase
        .from("leagues")
        .select("league_id, name")
        .in("league_id", ids)
        .returns<{ league_id: number; name: string | null }[]>();
      if (lRes.error) throw new Error(lRes.error.message);
      const nameById = new Map((lRes.data ?? []).map((l) => [l.league_id, l.name]));
      rows = ids
        .map((id) => {
          const a = agg.get(id)!;
          return {
            league_id: id,
            name: nameById.get(id) ?? `League ${id}`,
            matches: a.matches,
            first: a.first === Infinity ? 0 : a.first,
            last: a.last,
          };
        })
        .sort((a, b) => b.last - a.last); // turnamen terbaru dulu
    }
  } catch (e) {
    error = { message: e instanceof Error ? e.message : String(e) };
  }

  return (
    <main className="container">
      <section className="section-eyebrow">
        <h1>Tournaments</h1>
        <div className="sub">Turnamen dengan match di DB, terbaru dulu.</div>
      </section>

      {error ? (
        <p>Gagal baca data: {error.message}</p>
      ) : rows.length === 0 ? (
        <p>Belum ada turnamen. Jalankan job ingest dulu.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Tournament</th>
              <th>Tanggal</th>
              <th className="num">Matches</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.league_id}>
                <td>
                  <Link href={`/tournaments/${r.league_id}`}>{r.name}</Link>
                </td>
                <td className="dim">
                  {r.first ? fmtDate(r.first) : "—"}
                  {r.last && r.last !== r.first ? ` – ${fmtDate(r.last)}` : ""}
                </td>
                <td className="num">{r.matches}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
