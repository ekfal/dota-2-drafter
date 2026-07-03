"use client";

import { useState } from "react";
import { heroSrc, pct, wrTint } from "./PoolAccordion";
import type { Duo, RoleDuoGroup } from "./page";

const MIN_GAMES = 2; // ditonjolin kalau >= ini; sisanya (1-game) di "show more". Naikin ke 3 pas data numpuk.
const TOP = 6; // max duo prominent per grup

function MiniHero({ img, name, tint }: { img: string | null; name: string; tint: { color: string; alpha: number } }) {
  const src = heroSrc(img);
  return (
    <span className="duo-thumb" style={{ borderBottomColor: tint.color }} title={name}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} width={40} height={23} />
      ) : (
        <span className="duo-thumb-fallback">{name.slice(0, 3)}</span>
      )}
      <span className="duo-tint" style={{ backgroundColor: tint.color, opacity: tint.alpha }} />
    </span>
  );
}

function DuoRow({ d }: { d: Duo }) {
  const losses = d.games - d.wins;
  const tint = wrTint(d.wins, d.games);
  const low = d.games < MIN_GAMES;
  return (
    <div className="duo-row" style={low ? { opacity: 0.62 } : undefined}>
      <span className="duo-pics">
        <MiniHero img={d.a.img} name={d.a.name} tint={tint} />
        <MiniHero img={d.b.img} name={d.b.name} tint={tint} />
      </span>
      <span className="duo-body">
        <span className="duo-names">
          {d.a.name} <span className="dim">+</span> {d.b.name}
        </span>
        <span className="duo-stat">
          <span style={{ color: tint.color, fontWeight: 600 }}>{pct(d.wins, d.games)}%</span>{" "}
          <span className="dim">
            {d.wins}-{losses} · {d.games}g{low ? " · low" : ""}
          </span>
        </span>
      </span>
    </div>
  );
}

function Group({ group }: { group: RoleDuoGroup }) {
  const [open, setOpen] = useState(false);
  const strong = group.duos.filter((d) => d.games >= MIN_GAMES).slice(0, TOP);
  const rest = group.duos.filter((d) => !strong.includes(d));

  return (
    <div className="duo-group">
      <div className="duo-group-head">{group.label}</div>
      {group.duos.length === 0 ? (
        <div className="dim duo-empty">No data</div>
      ) : (
        <>
          {strong.length === 0 && <div className="dim duo-empty">No ≥{MIN_GAMES}-game duo</div>}
          {strong.map((d) => (
            <DuoRow key={`${d.a.hero_id}:${d.b.hero_id}`} d={d} />
          ))}
          {rest.length > 0 && (
            <>
              {open && rest.map((d) => <DuoRow key={`${d.a.hero_id}:${d.b.hero_id}`} d={d} />)}
              <button className="ban-toggle duo-more" onClick={() => setOpen((v) => !v)}>
                {open ? "Show less" : `Show more (${rest.length})`}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default function RoleDuos({ groups }: { groups: RoleDuoGroup[] }) {
  return (
    <div className="duo-grid">
      {groups.map((g) => (
        <Group key={g.label} group={g} />
      ))}
    </div>
  );
}
