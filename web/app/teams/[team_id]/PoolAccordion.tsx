"use client";

import { useState } from "react";
import Link from "next/link";
import type { PosData, PoolHero, DrillMatch, DrillPick } from "./page";

const CDN = "https://cdn.cloudflare.steamstatic.com";
export function heroSrc(img: string | null): string | null {
  if (!img) return null;
  return img.startsWith("http") ? img : `${CDN}${img}`;
}
export function pct(wins: number, games: number): number {
  return games ? Math.round((wins / games) * 100) : 0;
}
function fmtDur(sec: number | null): string {
  if (!sec || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function fmtDate(epoch: number | null): string {
  if (!epoch) return "—";
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

// BAGIAN A: winrate → warna kontinu (0% merah → 50% kuning → 100% hijau) sebagai tint overlay.
// alpha diredam sample kecil (<3 game) biar gak nyala penuh & nyesatin.
export function wrTint(wins: number, games: number): { color: string; alpha: number } {
  const wr = games ? wins / games : 0.5;
  const hue = Math.round(wr * 120); // 0=merah, 60=kuning, 120=hijau
  const color = `hsl(${hue}, 72%, 45%)`;
  const conf = Math.min(1, games / 3); // 1 game→0.33, 3+→1
  const spread = Math.abs(wr - 0.5) * 2; // 0 di 50%, 1 di ekstrem
  const alpha = Math.min(0.6, (0.22 + 0.34 * spread) * conf);
  return { color, alpha };
}

function MiniPortrait({ p, muted }: { p: DrillPick; muted?: boolean }) {
  const src = heroSrc(p.img);
  return (
    <span className={`mini ${muted ? "muted" : ""}`} title={p.name}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={p.name} width={38} height={22} />
      ) : (
        <span className="mini-fallback">{p.name.slice(0, 3)}</span>
      )}
    </span>
  );
}

function DrillMatchRow({ m }: { m: DrillMatch }) {
  const [showBans, setShowBans] = useState(false);
  const win = m.win === true;
  const loss = m.win === false;
  const result = m.win === null ? "?" : win ? "W" : "L";
  const bans = [...m.teamBans, ...m.oppBans];
  const lane =
    m.laneResult === 1
      ? { txt: "Lane W", cls: "lane-won" }
      : m.laneResult === -1
        ? { txt: "Lane L", cls: "lane-lost" }
        : m.laneResult === 0
          ? { txt: "Lane =", cls: "lane-tie" }
          : { txt: "Lane —", cls: "lane-na" };
  return (
    <div className={`drill-match ${win ? "won" : loss ? "lost" : ""}`}>
      <div className="dm-main">
        <span className={`dm-result ${win ? "wr-good" : loss ? "wr-bad" : "dim"}`}>{result}</span>
        <span className={`lane-chip ${lane.cls}`} title="Lane outcome @~10min (STRATZ)">
          {lane.txt}
        </span>
        <div className="dm-side">
          {m.teamPicks.map((p, i) => (
            <MiniPortrait key={i} p={p} />
          ))}
        </div>
        <div className="dm-mid">
          <span className="dim">{fmtDur(m.duration)}</span>
          <span className="dm-links">
            <a href={`https://www.dotabuff.com/matches/${m.matchId}`} target="_blank" rel="noreferrer">
              DB
            </a>
            <a href={`https://stratz.com/matches/${m.matchId}`} target="_blank" rel="noreferrer">
              STRATZ
            </a>
          </span>
          <span className="dim dm-date">{fmtDate(m.start_time)}</span>
        </div>
        <div className="dm-side right">
          {m.oppPicks.map((p, i) => (
            <MiniPortrait key={i} p={p} />
          ))}
        </div>
        <div className="dm-opp">
          vs {m.oppId ? <Link href={`/teams/${m.oppId}`}>{m.oppName}</Link> : m.oppName}
        </div>
      </div>

      {bans.length > 0 && (
        <div className="dm-bans-wrap">
          <button className="ban-toggle" onClick={() => setShowBans((v) => !v)}>
            {showBans ? "Hide bans" : "Show bans"} ({bans.length})
          </button>
          {showBans && (
            <div className="dm-bans">
              <span className="ban-label">Team</span>
              {m.teamBans.map((p, i) => (
                <MiniPortrait key={`t${i}`} p={p} muted />
              ))}
              <span className="ban-label">Opp</span>
              {m.oppBans.map((p, i) => (
                <MiniPortrait key={`o${i}`} p={p} muted />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Portrait({
  h,
  open,
  onToggle,
}: {
  h: PoolHero;
  open: boolean;
  onToggle: () => void;
}) {
  const src = heroSrc(h.img);
  const losses = h.games - h.wins;
  const { color, alpha } = wrTint(h.wins, h.games);
  return (
    <button
      type="button"
      className={`portrait ${open ? "open" : ""}`}
      onClick={onToggle}
      title={`${h.name} — ${h.wins}-${losses} (${pct(h.wins, h.games)}% WR, ${h.games} game)`}
    >
      <span className="thumb" style={{ borderBottomColor: color }}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={h.name} width={46} height={26} />
        ) : (
          <span className="thumb-fallback">{h.name.slice(0, 3)}</span>
        )}
        <span className="tint" style={{ backgroundColor: color, opacity: alpha }} />
      </span>
      <span className="g">
        {h.wins}-{losses} ({pct(h.wins, h.games)}%)
      </span>
    </button>
  );
}

export default function PoolAccordion({ positions }: { positions: PosData[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null); // single-open global
  const [openOthers, setOpenOthers] = useState<number | null>(null); // pos yg "other players"-nya kebuka

  return (
    <div className="pos-pool">
      {positions.map((row) => {
        const openHero = row.pool.find((h) => `${row.pos}:${h.hero_id}` === openKey) ?? null;
        const othersOpen = openOthers === row.pos;
        return (
          <div key={row.pos} className="pos-block">
            <div className="pos-row">
              <div className="pos-head">
                <div className="pos-tag">{row.label}</div>
                <div className="pos-player">
                  {row.playerId ? <Link href={`/players/${row.playerId}`}>{row.playerName}</Link> : row.playerName}
                  {row.mainGames === 0 && row.playerName !== "—" ? (
                    <span className="dim" style={{ fontWeight: 400 }}> · belum ada game</span>
                  ) : null}
                </div>
                {row.others.length > 0 && (
                  <button
                    type="button"
                    className={`pos-sub pos-others-toggle ${othersOpen ? "open" : ""}`}
                    onClick={() => setOpenOthers((cur) => (cur === row.pos ? null : row.pos))}
                  >
                    +{row.others.length} other player(s) {othersOpen ? "▾" : "▸"}
                  </button>
                )}
                {othersOpen && (
                  <div className="pos-others">
                    {row.others.map((o, i) => (
                      <div key={o.playerId ?? `anon${i}`} className="pos-other">
                        <span className="pos-other-name">
                          {o.playerId ? (
                            <Link href={`/players/${o.playerId}`}>{o.name}</Link>
                          ) : (
                            <span className="dim">{o.name}</span>
                          )}
                        </span>
                        <span className="dim pos-other-g">{o.games}g</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="pool">
                {row.pool.length === 0 ? (
                  <span className="pool-empty">
                    {row.playerName !== "—"
                      ? row.others.length > 0
                        ? "Belum ada game main di data — cek +N other player"
                        : "Belum ada game di data"
                      : "No data"}
                  </span>
                ) : (
                  row.pool.map((h) => {
                    const key = `${row.pos}:${h.hero_id}`;
                    return (
                      <Portrait
                        key={h.hero_id}
                        h={h}
                        open={key === openKey}
                        onToggle={() => setOpenKey((cur) => (cur === key ? null : key))}
                      />
                    );
                  })
                )}
              </div>
            </div>

            {openHero && (
              <div className="drill">
                <div className="drill-title">
                  {openHero.name} · {openHero.wins}-{openHero.games - openHero.wins} (
                  {pct(openHero.wins, openHero.games)}%) · {openHero.matches.length} match
                </div>
                {openHero.matches.length === 0 ? (
                  <div className="dim">No match data.</div>
                ) : (
                  openHero.matches.map((m) => <DrillMatchRow key={m.matchId} m={m} />)
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
