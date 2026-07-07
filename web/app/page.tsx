import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase";
import HomeSearch, { type SearchTeam, type SearchHero } from "./HomeSearch";

// #1 HOME — landing: global search (team+hero) + 3 entry blok (tournaments, top teams by Elo, patches).
export const dynamic = "force-dynamic";

interface TeamFull {
  team_id: number;
  name: string | null;
  tag: string | null;
  logo_url: string | null;
  rating: number | null;
}

function fmtDate(epoch: number | null | undefined): string {
  if (!epoch) return "—";
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

export default async function Home() {
  const supabase = getServerSupabase();

  // team match tally (biar cuma tim berdata yang tampil — no dead-end)
  const [mRes, heroesRes, statRes, patchesRes] = await Promise.all([
    supabase
      .from("matches")
      .select("radiant_team_id, dire_team_id")
      .returns<{ radiant_team_id: number | null; dire_team_id: number | null }[]>(),
    supabase
      .from("heroes")
      .select("hero_id, localized_name, img")
      .order("localized_name")
      .returns<{ hero_id: number; localized_name: string | null; img: string | null }[]>(),
    supabase.from("tournament_hero_stats").select("league_id").returns<{ league_id: number }[]>(),
    supabase
      .from("patches")
      .select("id, name, start_time")
      .order("start_time", { ascending: false })
      .limit(6)
      .returns<{ id: number; name: string; start_time: number }[]>(),
  ]);

  const count = new Map<number, number>();
  for (const m of mRes.data ?? [])
    for (const t of [m.radiant_team_id, m.dire_team_id]) if (t) count.set(t, (count.get(t) ?? 0) + 1);
  const teamIds = [...count.keys()];

  let teamsFull: TeamFull[] = [];
  if (teamIds.length > 0) {
    const tRes = await supabase
      .from("teams")
      .select("team_id, name, tag, logo_url, rating")
      .in("team_id", teamIds)
      .returns<TeamFull[]>();
    teamsFull = tRes.data ?? [];
  }

  // search list (semua tim berdata) + top Elo
  const searchTeams: SearchTeam[] = teamsFull
    .map((t) => ({ team_id: t.team_id, name: t.name, tag: t.tag, logo_url: t.logo_url }))
    .sort((a, b) => (count.get(b.team_id) ?? 0) - (count.get(a.team_id) ?? 0));
  const searchHeroes: SearchHero[] = (heroesRes.data ?? []).map((h) => ({
    hero_id: h.hero_id,
    name: h.localized_name ?? `Hero ${h.hero_id}`,
    img: h.img,
  }));
  const topElo = teamsFull
    .filter((t) => t.rating != null)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
    .slice(0, 8);

  // tournaments (yang punya agregat)
  const leagueIds = [...new Set((statRes.data ?? []).map((r) => r.league_id))];
  let leagues: { league_id: number; name: string | null }[] = [];
  if (leagueIds.length > 0) {
    const lRes = await supabase
      .from("leagues")
      .select("league_id, name")
      .in("league_id", leagueIds)
      .order("name")
      .returns<{ league_id: number; name: string | null }[]>();
    leagues = (lRes.data ?? []).slice(0, 8);
  }

  const patches = patchesRes.data ?? [];

  return (
    <main className="container">
      {/* hero / search */}
      <section className="home-hero">
        <h1 className="home-title">Dota 2 Draft Helper</h1>
        <p className="home-tag dim">Analisis draft pro & tournament — pick/ban, winrate, kombinasi, scouting lawan.</p>
        <HomeSearch teams={searchTeams} heroes={searchHeroes} />
      </section>

      {/* 3 entry blok */}
      <div className="home-grid">
        {/* Top Teams by Elo */}
        <section className="home-block">
          <div className="home-block-head">
            <h2>Top Teams by Elo</h2>
            <Link href="/teams" className="dim">All teams →</Link>
          </div>
          {topElo.length === 0 ? (
            <div className="dim">Belum ada rating.</div>
          ) : (
            <div className="elo-list">
              {topElo.map((t, i) => {
                const initials = (t.name ?? "T").slice(0, 2).toUpperCase();
                return (
                  <Link key={t.team_id} href={`/teams/${t.team_id}`} className="elo-card">
                    <span className="elo-rank dim">{i + 1}</span>
                    {t.logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="elo-logo" src={t.logo_url} alt="" width={26} height={26} />
                    ) : (
                      <span className="elo-logo-fb">{initials}</span>
                    )}
                    <span className="elo-name">{t.name ?? `Team ${t.team_id}`}</span>
                    <span className="elo-rating num">{Math.round(t.rating ?? 0)}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* Tournaments */}
        <section className="home-block">
          <div className="home-block-head">
            <h2>Tournaments</h2>
            <Link href="/tournaments" className="dim">All →</Link>
          </div>
          {leagues.length === 0 ? (
            <div className="dim">Belum ada agregat turnamen.</div>
          ) : (
            <div className="link-list">
              {leagues.map((l) => (
                <Link key={l.league_id} href={`/tournaments/${l.league_id}`} className="link-row">
                  {l.name ?? `League ${l.league_id}`}
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Patches */}
        <section className="home-block">
          <div className="home-block-head">
            <h2>Latest patches</h2>
            <Link href="/patches" className="dim">All →</Link>
          </div>
          {patches.length === 0 ? (
            <div className="dim">Belum ada patch.</div>
          ) : (
            <div className="link-list">
              {patches.map((p) => (
                <Link key={p.id} href={`/patches`} className="link-row patch-row">
                  <span>{p.name}</span>
                  <span className="dim">{fmtDate(p.start_time)}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
