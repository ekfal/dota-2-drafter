"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { TeamCard } from "./page";

// FR-2 entry /teams — grid kartu (logo + nama + rekor W-L) + search by nama/tag.
export default function TeamSearch({ teams }: { teams: TeamCard[] }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return teams;
    return teams.filter(
      (t) => (t.name ?? "").toLowerCase().includes(s) || (t.tag ?? "").toLowerCase().includes(s)
    );
  }, [q, teams]);

  return (
    <>
      <input
        className="search-input"
        type="search"
        placeholder="Cari team by nama / tag…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {filtered.length === 0 ? (
        <p className="dim">Tidak ada team cocok “{q}”.</p>
      ) : (
        <div className="team-grid">
          {filtered.map((t) => {
            const initials = (t.name ?? "T").slice(0, 2).toUpperCase();
            return (
              <Link key={t.team_id} href={`/teams/${t.team_id}`} className="team-card">
                {t.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="team-card-logo" src={t.logo_url} alt="" width={40} height={40} />
                ) : (
                  <span className="team-card-logo-fb">{initials}</span>
                )}
                <span className="team-card-body">
                  <span className="team-card-name">{t.name ?? `Team ${t.team_id}`}</span>
                  <span className="team-card-rec">
                    <span className="wr-good">{t.wins}W</span>–<span className="wr-bad">{t.losses}L</span>
                    <span className="dim"> · {t.matches}g</span>
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
