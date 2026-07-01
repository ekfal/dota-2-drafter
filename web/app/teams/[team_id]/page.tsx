import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase";
import PrintButton from "./PrintButton";

// FR-2 detail: most picked & most banned hero tim + win rate pick (dgn sample size). Anon read-only.
export const dynamic = "force-dynamic";

const CDN = "https://cdn.cloudflare.steamstatic.com";

interface HeroRef {
  localized_name: string | null;
  img: string | null;
}
interface StatRow {
  picks: number;
  pick_wins: number;
  bans: number;
  hero: HeroRef | null;
}

function heroImg(h: HeroRef | null): string | null {
  if (!h?.img) return null;
  return h.img.startsWith("http") ? h.img : `${CDN}${h.img}`;
}
function winRate(wins: number, picks: number): string {
  if (picks <= 0) return "—";
  return `${((wins / picks) * 100).toFixed(0)}%`;
}

function HeroCell({ hero }: { hero: HeroRef | null }) {
  const src = heroImg(hero);
  return (
    <>
      <td style={{ width: 60 }}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="hero-img" src={src} alt={hero?.localized_name ?? ""} width={48} height={27} />
        ) : null}
      </td>
      <td>{hero?.localized_name ?? "—"}</td>
    </>
  );
}

export default async function TeamDetailPage({ params }: { params: { team_id: string } }) {
  const id = Number(params.team_id);

  let name = `Team ${params.team_id}`;
  let picked: StatRow[] = [];
  let banned: StatRow[] = [];
  let error: { message: string } | null = null;

  if (!Number.isFinite(id)) {
    error = { message: `team_id tidak valid: ${params.team_id}` };
  } else {
    try {
      const supabase = getServerSupabase();
      const sel = `picks, pick_wins, bans, hero:heroes!team_hero_stats_hero_id_fkey(localized_name, img)`;
      const [tRes, pRes, bRes] = await Promise.all([
        supabase.from("teams").select("name").eq("team_id", id).maybeSingle<{ name: string | null }>(),
        supabase
          .from("team_hero_stats")
          .select(sel)
          .eq("team_id", id)
          .gt("picks", 0)
          .order("picks", { ascending: false })
          .limit(20)
          .returns<StatRow[]>(),
        supabase
          .from("team_hero_stats")
          .select(sel)
          .eq("team_id", id)
          .gt("bans", 0)
          .order("bans", { ascending: false })
          .limit(20)
          .returns<StatRow[]>(),
      ]);
      error = tRes.error ?? pRes.error ?? bRes.error;
      if (tRes.data?.name) name = tRes.data.name;
      picked = pRes.data ?? [];
      banned = bRes.data ?? [];
    } catch (e) {
      error = { message: e instanceof Error ? e.message : String(e) };
    }
  }

  return (
    <main className="container">
      <section className="section-eyebrow">
        <h1>{name}</h1>
        <div className="sub">
          <Link href="/teams">&larr; All teams</Link>
          {" · "}
          <PrintButton />
        </div>
      </section>

      {error ? (
        <p>Gagal baca data: {error.message}</p>
      ) : picked.length === 0 && banned.length === 0 ? (
        <p>Belum ada agregat untuk tim ini.</p>
      ) : (
        <div className="draft-grid">
          {/* Most picked + win rate pick (sample = jumlah pick) */}
          <div>
            <table className="data-table">
              <thead>
                <tr>
                  <th colSpan={4}>Most Picked</th>
                </tr>
                <tr>
                  <th colSpan={2}>Hero</th>
                  <th className="num">Picks</th>
                  <th className="num">Win%</th>
                </tr>
              </thead>
              <tbody>
                {picked.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">—</td>
                  </tr>
                ) : (
                  picked.map((r, i) => (
                    <tr key={r.hero?.localized_name ?? i}>
                      <HeroCell hero={r.hero} />
                      <td className="num">{r.picks}</td>
                      {/* Win rate SELALU dengan sample size */}
                      <td className="num">
                        {winRate(r.pick_wins, r.picks)} <span className="muted">({r.picks})</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Most banned (sample = jumlah ban) */}
          <div>
            <table className="data-table">
              <thead>
                <tr>
                  <th colSpan={3}>Most Banned</th>
                </tr>
                <tr>
                  <th colSpan={2}>Hero</th>
                  <th className="num">Bans</th>
                </tr>
              </thead>
              <tbody>
                {banned.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">—</td>
                  </tr>
                ) : (
                  banned.map((r, i) => (
                    <tr key={r.hero?.localized_name ?? i}>
                      <HeroCell hero={r.hero} />
                      <td className="num">{r.bans}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
