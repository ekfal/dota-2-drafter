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
