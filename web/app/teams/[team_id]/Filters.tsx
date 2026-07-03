"use client";

import { useRouter } from "next/navigation";

// FR-2 chunk1: patch (mandatory) + tournament (single, "All this patch") filter.
// Navigasi via query param (?patch=&league=). Ganti patch → reset league.
export default function Filters({
  teamId,
  patches,
  leagues,
  selectedPatch,
  selectedLeague,
}: {
  teamId: number;
  patches: { id: number; name: string }[];
  leagues: { id: number; name: string }[];
  selectedPatch: number;
  selectedLeague: number | null;
}) {
  const router = useRouter();

  function go(patch: number, league: number | null) {
    const qs = new URLSearchParams();
    qs.set("patch", String(patch));
    if (league !== null) qs.set("league", String(league));
    router.push(`/teams/${teamId}?${qs.toString()}`);
  }

  return (
    <div className="filter-bar">
      <label className="filter-field">
        <span>Patch</span>
        <select
          value={selectedPatch}
          onChange={(e) => go(Number(e.target.value), null)}
        >
          {patches.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <label className="filter-field">
        <span>Tournament</span>
        <select
          value={selectedLeague ?? ""}
          onChange={(e) =>
            go(selectedPatch, e.target.value === "" ? null : Number(e.target.value))
          }
        >
          <option value="">All (this patch)</option>
          {leagues.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
