/**
 * Deteksi kandidat team merge (entity resolution) — REPORT ONLY, tidak mengubah data.
 *
 * Bandingin tiap pasang tim: roster overlap (union team_player_roles + match_players)
 * + name similarity unicode-aware (CJK/Cyrillic/Arab tidak di-strip — bug v1).
 * Output 3 seksi: (a) KUAT (auto-suggest), (b) RAGU (butuh konfirmasi), (c) SKIP + alasan.
 * Alias existing (team_aliases) di-exclude. Merge tetap MANUAL: review dulu, insert alias
 * setelah ACK, lalu backfill (lihat komentar team_aliases di schema.sql).
 *
 * Kelas false-positive yang SENGAJA di-skip (jangan dilonggarin tanpa alasan):
 *  - nama identik + roster 0 shared = collision (kelas BoomBoys)
 *  - roster overlap tinggi + nama tak berelasi = player soup / club+timnas (kelas D)
 *
 * Run: npm run detect-merge:local  (tulis ke stdout; redirect sendiri kalau mau file)
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createDb } from "./core";

const db: SupabaseClient = createDb();

async function pageAll<T>(q: (f: number, t: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const P = 1000;
  const out: T[] = [];
  for (let f = 0; ; f += P) {
    const { data } = await q(f, f + P - 1);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < P) break;
  }
  return out;
}

// ---------- name utils (UNICODE: \p{L}\p{N} — CJK/Cyrillic/Arab/Korea kept) ----------
const norm = (s: string): string => s.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "");
function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array<number>(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0]![j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + c);
    }
  return d[m]![n]!;
}
const STOP = new Set(["team", "esports", "esport", "e-sports", "gaming", "club", "gg", "the"]);
const toks = (s: string): string[] =>
  s.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{N}]+/u).filter((t) => t && !STOP.has(t));
interface NameRel {
  identical: boolean;
  subset: boolean;
  tokF: number;
  levR: number;
  score: number;
}
function rel(x: string, y: string): NameRel {
  const a = norm(x), b = norm(y);
  const identical = a.length > 0 && a === b;
  const subset = a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a)) && !identical;
  const ta = toks(x), tb = toks(y);
  let matched = 0;
  for (const p of ta) if (tb.some((q) => p === q || (Math.min(p.length, q.length) >= 4 && lev(p, q) <= 1))) matched++;
  const tokF = ta.length && tb.length ? matched / Math.min(ta.length, tb.length) : 0;
  const levR = a.length && b.length ? 1 - lev(a, b) / Math.max(a.length, b.length) : 0;
  return { identical, subset, tokF, levR, score: Math.max(identical ? 1 : 0, subset ? 0.8 : 0, tokF * 0.9, levR) };
}

async function main(): Promise<void> {
  const { data: teams } = await db.from("teams").select("team_id, name").returns<{ team_id: number; name: string | null }[]>();
  const { data: aliasRows } = await db
    .from("team_aliases")
    .select("alias_team_id, canonical_team_id")
    .returns<{ alias_team_id: number; canonical_team_id: number }[]>();
  const aliasIds = new Set((aliasRows ?? []).map((a) => a.alias_team_id));
  const canonOf = new Map((aliasRows ?? []).map((a) => [a.alias_team_id, a.canonical_team_id]));

  const roleRows = await pageAll<{ team_id: number; account_id: number }>((f, t) =>
    db.from("team_player_roles").select("team_id, account_id").range(f, t).returns<{ team_id: number; account_id: number }[]>()
  );
  const matches = await pageAll<{ match_id: number; radiant_team_id: number | null; dire_team_id: number | null }>((f, t) =>
    db.from("matches").select("match_id, radiant_team_id, dire_team_id").range(f, t).returns<{ match_id: number; radiant_team_id: number | null; dire_team_id: number | null }[]>()
  );
  const mp = await pageAll<{ match_id: number; account_id: number | null; is_radiant: boolean }>((f, t) =>
    db.from("match_players").select("match_id, account_id, is_radiant").range(f, t).returns<{ match_id: number; account_id: number | null; is_radiant: boolean }[]>()
  );

  const nm = new Map<number, string>();
  for (const t of teams ?? []) nm.set(t.team_id, t.name ?? `Team ${t.team_id}`);
  const side = new Map<number, { r: number | null; d: number | null }>();
  for (const m of matches) side.set(m.match_id, { r: m.radiant_team_id, d: m.dire_team_id });
  const acct = new Map<number, Set<number>>();
  const games = new Map<number, number>();
  const add = (tid: number | null, a: number | null): void => {
    if (!tid || !a || a <= 0) return;
    const s = acct.get(tid) ?? new Set<number>();
    s.add(a);
    acct.set(tid, s);
  };
  for (const r of roleRows) add(r.team_id, r.account_id);
  for (const x of mp) {
    const s = side.get(x.match_id);
    if (!s) continue;
    add(x.is_radiant ? s.r : s.d, x.account_id);
  }
  for (const m of matches) for (const t of [m.radiant_team_id, m.dire_team_id]) if (t) games.set(t, (games.get(t) ?? 0) + 1);

  const allIds = (teams ?? []).map((t) => t.team_id).filter((id) => !aliasIds.has(id));

  console.log(`=== MERGE CANDIDATES — ${new Date().toISOString().slice(0, 10)} ===`);
  console.log(`teams total=${teams?.length} | alias resolved (excluded)=${aliasIds.size} | eligible=${allIds.length}`);
  const noData = allIds.filter((id) => !(acct.get(id)?.size));
  console.log(`GAP-CHECK: tim tanpa data akun (name-pass only)=${noData.length}`);
  console.log("");

  interface Row {
    a: number; b: number; sh: number; ua: number; ub: number; ga: number; gb: number; r: NameRel; fullSub: boolean;
  }
  function build(a: number, b: number): Row {
    const A = acct.get(a) ?? new Set<number>(), B = acct.get(b) ?? new Set<number>();
    let sh = 0;
    for (const x of A) if (B.has(x)) sh++;
    const mn = Math.min(A.size, B.size);
    return { a, b, sh, ua: A.size, ub: B.size, ga: games.get(a) ?? 0, gb: games.get(b) ?? 0, r: rel(nm.get(a)!, nm.get(b)!), fullSub: mn > 0 && sh === mn };
  }
  const fmt = (w: Row, why: string): string =>
    `${nm.get(w.a)} (${w.a}, ${w.ga}g) <-> ${nm.get(w.b)} (${w.b}, ${w.gb}g) | shared ${w.sh} (${w.ua}/${w.ub})${w.fullSub && w.sh > 0 ? " FULL-SUBSET" : ""} | name: ident=${w.r.identical ? "Y" : "n"} sub=${w.r.subset ? "Y" : "n"} tok=${w.r.tokF.toFixed(2)} lev=${w.r.levR.toFixed(2)} | ${why}`;

  const kuat: string[] = [], ragu: string[] = [], skip: string[] = [];
  for (let i = 0; i < allIds.length; i++)
    for (let j = i + 1; j < allIds.length; j++) {
      const a = allIds[i]!, b = allIds[j]!;
      if ((canonOf.get(a) ?? a) === (canonOf.get(b) ?? b)) continue;
      const nameScore = rel(nm.get(a)!, nm.get(b)!).score;
      const hasA = (acct.get(a)?.size ?? 0) > 0, hasB = (acct.get(b)?.size ?? 0) > 0;
      if (!(hasA && hasB) && nameScore < 0.85) continue;
      const w = build(a, b);
      if (w.sh < 1 && nameScore < 0.85) continue;
      const R = w.r;
      const nameRel = R.identical || R.subset || R.tokF >= 0.99 || R.levR >= 0.6;
      if (R.identical && w.sh >= 3) kuat.push(fmt(w, "nama identik + roster shared"));
      else if (nameRel && (w.sh >= 5 || (w.fullSub && w.sh >= 4))) kuat.push(fmt(w, "nama related + roster kuat"));
      else if (R.identical && (!hasA || !hasB)) ragu.push(fmt(w, "nama identik, satu sisi tanpa data akun"));
      else if (R.identical && w.sh >= 1) ragu.push(fmt(w, `nama identik, shared cuma ${w.sh}`));
      else if (nameRel && w.sh >= 3) ragu.push(fmt(w, "nama related, roster 3-4"));
      else if (R.levR >= 0.75 && w.sh >= 1) ragu.push(fmt(w, "nama near-identik (typo?), ada shared"));
      else if (R.identical && w.sh === 0 && hasA && hasB) skip.push(fmt(w, "SKIP: nama sama roster 0 shared = collision (kelas BoomBoys)"));
      else if (w.sh >= 5) skip.push(fmt(w, "SKIP: roster overlap tinggi TANPA relasi nama = player soup / club+timnas (kelas D)"));
      else if (w.sh >= 3) skip.push(fmt(w, "SKIP: shared 3-4 tanpa relasi nama (noise standin)"));
    }
  console.log(`--- (a) KANDIDAT KUAT (${kuat.length}) ---`);
  for (const s of kuat) console.log(s);
  if (!kuat.length) console.log("(kosong)");
  console.log("");
  console.log(`--- (b) RAGU — butuh konfirmasi (${ragu.length}) ---`);
  for (const s of ragu) console.log(s);
  if (!ragu.length) console.log("(kosong)");
  console.log("");
  console.log(`--- (c) SENGAJA DI-SKIP + alasan (${skip.length}) ---`);
  for (const s of skip) console.log(s);
  if (!skip.length) console.log("(kosong)");
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
