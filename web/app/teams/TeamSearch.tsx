"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

// FR-2 chunk1: entry point /teams — search by nama/tag (client-side, list kecil).
interface TeamRow {
  team_id: number;
  name: string | null;
  tag: string | null;
  matches: number;
}

export default function TeamSearch({ teams }: { teams: TeamRow[] }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return teams;
    return teams.filter(
      (t) =>
        (t.name ?? "").toLowerCase().includes(s) || (t.tag ?? "").toLowerCase().includes(s)
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
        <table className="data-table">
          <thead>
            <tr>
              <th>Team</th>
              <th>Tag</th>
              <th className="num">Matches</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.team_id}>
                <td>
                  <Link href={`/teams/${t.team_id}`}>{t.name ?? `Team ${t.team_id}`}</Link>
                </td>
                <td className="dim">{t.tag ?? "—"}</td>
                <td className="num">{t.matches}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
