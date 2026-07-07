"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

// #1 home global search — team + hero (player skip dulu). Client-side, list kecil.
const CDN = "https://cdn.cloudflare.steamstatic.com";
function heroSrc(img: string | null): string | null {
  if (!img) return null;
  return img.startsWith("http") ? img : `${CDN}${img}`;
}

export interface SearchTeam {
  team_id: number;
  name: string | null;
  tag: string | null;
  logo_url: string | null;
}
export interface SearchHero {
  hero_id: number;
  name: string;
  img: string | null;
}

export default function HomeSearch({ teams, heroes }: { teams: SearchTeam[]; heroes: SearchHero[] }) {
  const [q, setQ] = useState("");
  const s = q.trim().toLowerCase();

  const teamHits = useMemo(() => {
    if (!s) return [];
    return teams
      .filter((t) => (t.name ?? "").toLowerCase().includes(s) || (t.tag ?? "").toLowerCase().includes(s))
      .slice(0, 6);
  }, [s, teams]);

  const heroHits = useMemo(() => {
    if (!s) return [];
    return heroes.filter((h) => h.name.toLowerCase().includes(s)).slice(0, 6);
  }, [s, heroes]);

  const empty = s.length > 0 && teamHits.length === 0 && heroHits.length === 0;

  return (
    <div className="home-search">
      <input
        className="search-input home-search-input"
        type="search"
        placeholder="Cari team atau hero…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />

      {s.length > 0 && (
        <div className="home-search-results card">
          {empty ? (
            <div className="dim">Tidak ada team / hero cocok “{q}”.</div>
          ) : (
            <>
              {teamHits.length > 0 && (
                <div className="hsr-group">
                  <div className="label">Teams</div>
                  {teamHits.map((t) => {
                    const initials = (t.name ?? "T").slice(0, 2).toUpperCase();
                    return (
                      <Link key={t.team_id} href={`/teams/${t.team_id}`} className="hsr-row">
                        {t.logo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className="hsr-logo" src={t.logo_url} alt="" width={22} height={22} />
                        ) : (
                          <span className="hsr-logo-fb">{initials}</span>
                        )}
                        <span className="hsr-name">{t.name ?? `Team ${t.team_id}`}</span>
                        {t.tag ? <span className="dim hsr-sub">{t.tag}</span> : null}
                      </Link>
                    );
                  })}
                </div>
              )}
              {heroHits.length > 0 && (
                <div className="hsr-group">
                  <div className="label">Heroes</div>
                  {heroHits.map((h) => {
                    const src = heroSrc(h.img);
                    return (
                      <Link key={h.hero_id} href={`/heroes/${h.hero_id}`} className="hsr-row">
                        {src ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className="hsr-hero" src={src} alt="" width={34} height={20} />
                        ) : (
                          <span className="hsr-logo-fb">{h.name.slice(0, 2)}</span>
                        )}
                        <span className="hsr-name">{h.name}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
