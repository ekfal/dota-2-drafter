import { NextRequest } from "next/server";

// Proxy gambar buat export PDF: Steam CDN kasih ACAO https://www.dota2.com (bukan wildcard)
// → html2canvas gagal baca portrait cross-origin. Route ini fetch server-side, serve same-origin.
// GUARD: whitelist host — JANGAN jadi open proxy (bisa dipakai relay sembarang URL).
const ALLOWED_HOSTS = new Set([
  "cdn.cloudflare.steamstatic.com", // hero portrait
  "cdn.steamstatic.com", // hero portrait (host lama)
  "cdn.steamusercontent.com", // team logo (OpenDota logo_url)
]);

export async function GET(req: NextRequest): Promise<Response> {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) return new Response("url required", { status: 400 });
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return new Response("bad url", { status: 400 });
  }
  if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.hostname)) {
    return new Response("host not allowed", { status: 403 });
  }
  const res = await fetch(u, { cache: "force-cache" }); // gambar statis — cache di server
  if (!res.ok || !res.body) return new Response(`upstream ${res.status}`, { status: 502 });
  return new Response(res.body, {
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "image/png",
      // statis (hero portrait/logo) → cache panjang di browser
      "Cache-Control": "public, max-age=604800, immutable",
    },
  });
}
