/**
 * Derivasi posisi 1-5 per player, NET-WORTH-FIRST (Dota-correct, robust).
 *
 * 1. Split tim by net_worth: top 3 = cores, bottom 2 = supports (jurang farm besar → stabil,
 *    kebal roamer/jungle/lane-swap).
 * 2. Cores: pos2 = core dgn lane_role==2 (mid). Dua sisa: nw tinggi = pos1 (carry), rendah = pos3 (off).
 *    Kalau mid tak jelas (bukan tepat 1 core lane_role==2), fallback: pure nw rank cores (1,2,3).
 * 3. Supports: nw tinggi = pos4 (soft/roamer), rendah = pos5 (hard, paling miskin).
 * 4. net_worth null (belum parsed) → tak bisa derive → kosong (position null).
 *
 * position = DERIVED/heuristik (bisa salah di draft eksotis), recomputable dari net_worth+lane_role.
 */
export interface PlayerNW {
  player_slot: number;
  net_worth: number | null;
  lane_role: number | null;
}

/** Return Map<player_slot, position(1-5)>. Kosong kalau tak bisa derive (net_worth null / bukan 5 player). */
export function derivePositions(sidePlayers: PlayerNW[]): Map<number, number> {
  const out = new Map<number, number>();
  if (sidePlayers.length !== 5) return out;
  if (sidePlayers.some((p) => p.net_worth === null || p.net_worth === undefined)) return out;

  const sorted = [...sidePlayers].sort(
    (a, b) => (b.net_worth as number) - (a.net_worth as number) || a.player_slot - b.player_slot
  );
  const cores = sorted.slice(0, 3);
  const sups = sorted.slice(3, 5);

  const mids = cores.filter((p) => p.lane_role === 2);
  if (mids.length === 1) {
    const mid = mids[0];
    const others = cores
      .filter((p) => p !== mid)
      .sort((a, b) => (b.net_worth as number) - (a.net_worth as number));
    const [carry, off] = others;
    if (mid && carry && off) {
      out.set(carry.player_slot, 1);
      out.set(mid.player_slot, 2);
      out.set(off.player_slot, 3);
    }
  } else {
    // mid tak jelas → pure nw rank cores
    const [c1, c2, c3] = cores;
    if (c1 && c2 && c3) {
      out.set(c1.player_slot, 1);
      out.set(c2.player_slot, 2);
      out.set(c3.player_slot, 3);
    }
  }

  const [soft, hard] = sups;
  if (soft) out.set(soft.player_slot, 4);
  if (hard) out.set(hard.player_slot, 5);
  return out;
}
