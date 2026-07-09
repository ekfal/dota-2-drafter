/**
 * Supabase client (FE, read-only).
 * Pakai ANON key + RLS read-only. Front-end TIDAK PERNAH menyentuh OpenDota (CLAUDE.md §3).
 *
 * Factory (bukan throw di import) biar `next dev`/`build` tetap boot walau env belum diisi —
 * error muncul saat request (ditangani di page sebagai pesan, bukan crash server).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function getServerSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Set NEXT_PUBLIC_SUPABASE_URL & NEXT_PUBLIC_SUPABASE_ANON_KEY di web/.env.local"
    );
  }
  return createClient(url, anonKey, { auth: { persistSession: false } });
}

/**
 * Ambil SEMUA baris via range pagination — hindari cap 1000 baris PostgREST yang diam-diam truncate.
 * makeQuery(from,to) harus balikin query dengan .range(from,to).returns<T[]>(). Loop sampai < 1000.
 * Pakai buat scan tabel besar (matches, picks_bans, *_hero_stats) yang bisa > 1000 baris.
 */
export async function pageAll<T>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await makeQuery(from, from + PAGE - 1);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}
