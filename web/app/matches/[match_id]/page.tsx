import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase";

// FR-4 match drill-down. Baca picks_bans + header dari DB (anon, read-only). FE tak sentuh OpenDota.
export const dynamic = "force-dynamic";

interface TeamRef {
  name: string | null;
}
interface LeagueRef {
  name: string | null;
}
interface HeroRef {
  localized_name: string | null;
  img: string | null; // path CDN relatif
}

const CDN = "https://cdn.cloudflare.steamstatic.com";
function heroImg(h: HeroRef | null): string | null {
  if (!h?.img) return null;
  return h.img.startsWith("http") ? h.img : `${CDN}${h.img}`;
}
interface MatchHeader {
  match_id: number;
  start_time: number | null;
  duration: number | null;
  radiant_win: boolean | null;
  radiant_team: TeamRef | null;
  dire_team: TeamRef | null;
  league: LeagueRef | null;
}
interface PbRow {
  ord: number;
  is_pick: boolean;
  team: number; // 0 radiant, 1 dire
  hero: HeroRef | null;
}

function fmtDate(epoch: number | null): string {
  if (!epoch) return "—";
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}
function fmtDuration(sec: number | null): string {
  if (sec === null || sec === undefined) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function heroName(h: HeroRef | null, fallback: number): string {
  return h?.localized_name ?? String(fallback);
}

// Satu sisi draft: urut by ord, pick vs ban jelas (ban di-mute).
function DraftSide({ title, rows }: { title: string; rows: PbRow[] }) {
  return (
    <div>
      <table className="data-table">
        <thead>
          <tr>
            <th colSpan={3}>{title}</th>
          </tr>
          <tr>
            <th className="num">Ord</th>
            <th>Type</th>
            <th colSpan={2}>Hero</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="muted">
                —
              </td>
            </tr>
          ) : (
            rows.map((r) => {
              const src = heroImg(r.hero);
              return (
                <tr key={r.ord} className={r.is_pick ? undefined : "muted"}>
                  <td className="num">{r.ord}</td>
                  <td>{r.is_pick ? "PICK" : "ban"}</td>
                  <td style={{ width: 60 }}>
                    {src ? (
                      // Square + hard bevel (DESIGN.md), jangan rounded. next/image tak dipakai (CDN eksternal, slim).
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="hero-img" src={src} alt={heroName(r.hero, r.ord)} width={48} height={27} />
                    ) : null}
                  </td>
                  <td>{heroName(r.hero, r.ord)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

export default async function MatchDetailPage({
  params,
}: {
  params: { match_id: string };
}) {
  const id = Number(params.match_id);

  let header: MatchHeader | null = null;
  let pb: PbRow[] = [];
  let error: { message: string } | null = null;

  if (!Number.isFinite(id)) {
    error = { message: `match_id tidak valid: ${params.match_id}` };
  } else {
    try {
      const supabase = getServerSupabase();
      const [hRes, pRes] = await Promise.all([
        supabase
          .from("matches")
          .select(
            `match_id, start_time, duration, radiant_win,
             radiant_team:teams!matches_radiant_team_id_fkey(name),
             dire_team:teams!matches_dire_team_id_fkey(name),
             league:leagues!matches_league_id_fkey(name)`
          )
          .eq("match_id", id)
          .maybeSingle<MatchHeader>(),
        supabase
          .from("picks_bans")
          .select(
            `ord, is_pick, team,
             hero:heroes!picks_bans_hero_id_fkey(localized_name, img)`
          )
          .eq("match_id", id)
          .order("ord")
          .returns<PbRow[]>(),
      ]);
      error = hRes.error ?? pRes.error;
      header = hRes.data;
      pb = pRes.data ?? [];
    } catch (e) {
      error = { message: e instanceof Error ? e.message : String(e) };
    }
  }

  const radiant = pb.filter((r) => r.team === 0);
  const dire = pb.filter((r) => r.team === 1);
  const rName = header?.radiant_team?.name ?? "Radiant";
  const dName = header?.dire_team?.name ?? "Dire";
  const winner =
    header?.radiant_win === null || header?.radiant_win === undefined
      ? "—"
      : header.radiant_win
      ? rName
      : dName;

  return (
    <main className="container">
      <section className="section-eyebrow">
        <h1>Match Detail</h1>
        <div className="sub">
          <Link href="/matches">&larr; Back to matches</Link>
        </div>
      </section>

      {error ? (
        <p>Gagal baca data: {error.message}</p>
      ) : !header ? (
        <p>Match tidak ditemukan.</p>
      ) : (
        <>
          {/* Header: team vs team, pemenang, league, tanggal, durasi */}
          <table className="data-table" style={{ marginBottom: 32 }}>
            <thead>
              <tr>
                <th colSpan={2}>
                  {rName} vs {dName}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Match</td>
                <td className="num">{header.match_id}</td>
              </tr>
              <tr>
                <td>Winner</td>
                <td>{winner}</td>
              </tr>
              <tr>
                <td>League</td>
                <td>{header.league?.name ?? "—"}</td>
              </tr>
              <tr>
                <td>Date</td>
                <td className="num">{fmtDate(header.start_time)}</td>
              </tr>
              <tr>
                <td>Duration</td>
                <td className="num">{fmtDuration(header.duration)}</td>
              </tr>
            </tbody>
          </table>

          {/* Draft: non-CM = pesan rapi, bukan crash */}
          {pb.length === 0 ? (
            <p>Match ini tanpa draft (non-Captains Mode).</p>
          ) : (
            <div className="draft-grid">
              <DraftSide title={`${rName} (Radiant)`} rows={radiant} />
              <DraftSide title={`${dName} (Dire)`} rows={dire} />
            </div>
          )}
        </>
      )}
    </main>
  );
}
