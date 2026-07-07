import { getServerSupabase } from "@/lib/supabase";

// #1 minimal patches list (nav target). #2 nambah cross-link ke match/turnamen per patch.
export const dynamic = "force-dynamic";

function fmtDate(epoch: number | null | undefined): string {
  if (!epoch) return "—";
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

export default async function PatchesPage() {
  let patches: { id: number; name: string; start_time: number }[] = [];
  let error: { message: string } | null = null;
  try {
    const supabase = getServerSupabase();
    const res = await supabase
      .from("patches")
      .select("id, name, start_time")
      .order("start_time", { ascending: false })
      .returns<{ id: number; name: string; start_time: number }[]>();
    if (res.error) throw new Error(res.error.message);
    patches = res.data ?? [];
  } catch (e) {
    error = { message: e instanceof Error ? e.message : String(e) };
  }

  return (
    <main className="container">
      <section className="section-eyebrow">
        <h1>Patches</h1>
        <div className="sub">Patch pro yang tercatat, terbaru dulu.</div>
      </section>

      {error ? (
        <p>Gagal baca data: {error.message}</p>
      ) : patches.length === 0 ? (
        <p>Belum ada patch.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Patch</th>
              <th className="num">Rilis</th>
            </tr>
          </thead>
          <tbody>
            {patches.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className="num dim">{fmtDate(p.start_time)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
