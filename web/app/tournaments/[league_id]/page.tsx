import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase";

// FR-1 detail: ranking hero by pick / ban / contest untuk satu turnamen. Anon read-only.
export const dynamic = "force-dynamic";

const CDN = "https://cdn.cloudflare.steamstatic.com";

interface HeroRef {
  localized_name: string | null;
  img: string | null;
}
interface StatRow {
  picks: number;
  bans: number;
  contest: number;
  hero: HeroRef | null;
}

type SortKey = "pick" | "ban" | "contest";
const SORT_COL: Record<SortKey, "picks" | "bans" | "contest"> = {
  pick: "picks",
  ban: "bans",
  contest: "contest",
};

function heroImg(h: HeroRef | null): string | null {
  if (!h?.img) return null;
  return h.img.startsWith("http") ? h.img : `${CDN}${h.img}`;
}
function pct(n: number, total: number): string {
  if (total <= 0) return "—";
  return `${((n / total) * 100).toFixed(0)}%`;
}

export default async function TournamentDetailPage({
  params,
  searchParams,
}: {
  params: { league_id: string };
  searchParams: { sort?: string };
}) {
  const id = Number(params.league_id);
  const sort: SortKey =
    searchParams.sort === "pick" || searchParams.sort === "ban" ? searchParams.sort : "contest";

  let name = `League ${params.league_id}`;
  let totalMatches = 0;
  let rows: StatRow[] = [];
  let error: { message: string } | null = null;

  if (!Number.isFinite(id)) {
    error = { message: `league_id tidak valid: ${params.league_id}` };
  } else {
    try {
      const supabase = getServerSupabase();
      const [lRes, mRes, sRes] = await Promise.all([
        supabase.from("leagues").select("name").eq("league_id", id).maybeSingle<{ name: string | null }>(),
        supabase.from("matches").select("*", { count: "exact", head: true }).eq("league_id", id),
        supabase
          .from("tournament_hero_stats")
          .select(
            `picks, bans, contest,
             hero:heroes!tournament_hero_stats_hero_id_fkey(localized_name, img)`
          )
          .eq("league_id", id)
          .order(SORT_COL[sort], { ascending: false })
          .limit(60)
          .returns<StatRow[]>(),
      ]);
      error = lRes.error ?? mRes.error ?? sRes.error;
      if (lRes.data?.name) name = lRes.data.name;
      totalMatches = mRes.count ?? 0;
      rows = sRes.data ?? [];
    } catch (e) {
      error = { message: e instanceof Error ? e.message : String(e) };
    }
  }

  // Header sortable via query param (server-side re-order, no client JS).
  const sortLink = (key: SortKey, label: string) => (
    <Link href={`/tournaments/${params.league_id}?sort=${key}`}>
      {label}
      {sort === key ? " ▾" : ""}
    </Link>
  );

  return (
    <main className="container">
      <section className="section-eyebrow">
        <h1>{name}</h1>
        <div className="sub">
          <Link href="/tournaments">&larr; All tournaments</Link>
          {" · "}
          {/* Angka selalu dengan sample size */}
          Sample: {totalMatches} match
        </div>
      </section>

      {error ? (
        <p>Gagal baca data: {error.message}</p>
      ) : rows.length === 0 ? (
        <p>Belum ada agregat untuk turnamen ini.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th colSpan={2}>Hero</th>
              <th className="num">{sortLink("pick", "Picks")}</th>
              <th className="num">{sortLink("ban", "Bans")}</th>
              <th className="num">{sortLink("contest", "Contest")}</th>
              <th className="num">Contest%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const src = heroImg(r.hero);
              return (
                <tr key={r.hero?.localized_name ?? i}>
                  <td className="num">{i + 1}</td>
                  <td style={{ width: 60 }}>
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="hero-img" src={src} alt={r.hero?.localized_name ?? ""} width={48} height={27} />
                    ) : null}
                  </td>
                  <td>{r.hero?.localized_name ?? "—"}</td>
                  <td className="num">{r.picks}</td>
                  <td className="num">{r.bans}</td>
                  <td className="num">{r.contest}</td>
                  <td className="num">{pct(r.contest, totalMatches)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
