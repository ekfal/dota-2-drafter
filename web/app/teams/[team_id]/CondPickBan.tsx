"use client";

import { useState } from "react";
import { heroSrc } from "./PoolAccordion";
import type { CondPick } from "./page";

function Thumb({ img, name, w = 46, h = 26 }: { img: string | null; name: string; w?: number; h?: number }) {
  const src = heroSrc(img);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="cpb-img" src={src} alt={name} width={w} height={h} title={name} />
  ) : (
    <span className="cpb-fallback" style={{ width: w, height: h }}>
      {name.slice(0, 3)}
    </span>
  );
}

export default function CondPickBan({ picks }: { picks: CondPick[] }) {
  const [sel, setSel] = useState<number | null>(picks.length ? picks[0]!.hero_id : null);
  if (picks.length === 0) return <div className="dim">No pick data in scope.</div>;

  const active = picks.find((p) => p.hero_id === sel) ?? picks[0]!;
  // picks sudah urut reliable dulu (server). Cari batas transisi buat divider "low confidence".
  const firstIndicative = picks.findIndex((p) => !p.reliable);

  return (
    <div className="cpb">
      {/* kiri: list hero yang di-pick — reliable dulu, lalu indikatif (dimmed) */}
      <div className="cpb-list">
        {picks.map((p, i) => (
          <div key={p.hero_id}>
            {i === firstIndicative && firstIndicative > 0 ? (
              <div className="cpb-divider dim">Low confidence · n&lt;8</div>
            ) : null}
            <button
              className={`cpb-pick ${p.hero_id === active.hero_id ? "active" : ""}`}
              style={p.reliable ? undefined : { opacity: 0.6 }}
              onClick={() => setSel(p.hero_id)}
            >
              <Thumb img={p.img} name={p.name} w={40} h={23} />
              <span className="cpb-pick-name">{p.name}</span>
              <span className="dim cpb-pick-n">{p.reliable ? `${p.pickCount}g` : `n${p.pickCount}`}</span>
            </button>
          </div>
        ))}
      </div>

      {/* kanan: co-ban hero terpilih — urut lift desc */}
      <div className="cpb-panel">
        <div className="cpb-panel-head">
          When picked <b>{active.name}</b> <span className="dim">({active.pickCount}g)</span>
          {active.reliable ? null : (
            <span className="cpb-flag" title="Pick sample kecil (n<8) — anggap indikasi awal, bukan sinyal kuat">
              n&lt;8
            </span>
          )}
        </div>
        {active.cobans.length === 0 ? (
          <div className="dim">No bans recorded in these matches.</div>
        ) : (
          <div className="cpb-bans">
            {active.cobans.map((b) => {
              const meta = b.lift < 1.2; // lift ~1 = meta-ban, redam
              return (
                <div key={b.hero_id} className="cpb-ban" style={meta ? { opacity: 0.5 } : undefined}>
                  <Thumb img={b.img} name={b.name} />
                  <span className="cpb-ban-name">{b.name}</span>
                  <span className="cpb-ban-count">
                    <b className={`cpb-lift ${b.lift >= 2 ? "wr-good" : ""}`}>{b.lift.toFixed(1)}×</b>
                    <span className="dim cpb-co">{b.co}/{active.pickCount}</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
