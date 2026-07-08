# CLAUDE.md — Dota 2 Draft Helper

Panduan kerja untuk Claude Code di repo ini. Baca ini dulu sebelum nulis kode apa pun.

## 1. Apa ini

Tool analisis draft pro/tournament Dota 2. Bukan helper pub real-time, bukan overlay in-game.
Use-case utama: captain/analis lihat pick-ban, win rate, kombinasi draft, dan scouting lawan.

Sumber kebenaran lengkap: `Dota2_Draft_Helper_PRD.docx` (v0.4) + delta terbaru di `PRD-ADDENDUM.md`. Kalau ada konflik antara file ini dan PRD, PRD menang — lapor dulu sebelum lanjut.

## 2. Stack (terkunci)

- **DB + API baca**: Supabase (Postgres managed + auto REST API + Auth).
- **Frontend**: Next.js (App Router) → deploy Vercel / Cloudflare Pages. UI **wajib** ikut `DESIGN.md`.
- **Ingest worker**: GitHub Actions cron (atau Supabase Edge Function). Poll OpenDota, tulis ke Supabase.
- **Bahasa**: TypeScript di mana-mana. Hindari `any`.
- **Back-end kustom**: minimal. Default baca lewat auto-API Supabase; tambah server logic hanya kalau SQL tidak cukup.

## 3. Prinsip arsitektur (jangan dilanggar)

1. **DB sendiri.** Front-end TIDAK PERNAH memanggil OpenDota/STRATZ/Liquipedia langsung. Hanya worker yang menyentuh sumber eksternal. UI hanya baca Supabase.
2. **Slim storage.** Jangan simpan blob telemetry mentah (`gold_t`, `xp_t`, array player penuh). Simpan hanya kolom yang dipakai (lihat skema §5). Target muat 500 MB free tier.
3. **Tabel hitungan = derived.** `tournament_hero_stats`, `team_hero_stats`, `hero_pairs`, `hero_role_dist`, `team_player_roles` selalu bisa di-rebuild dari sumber (mentah / STRATZ). Jangan jadikan satu-satunya tempat data.
4. **Join key = `match_id` Valve.** Konsisten lintas tabel & sumber.
5. **Incremental via watermark.** Worker baca `ingest_state` (mis. `last_promatch_id`), proses hanya yang lebih baru. Backfill historis dicicil, jangan sekali hajar.

## 4. Aturan ngoding

- **Perubahan minimal & iteratif.** Satu PR/commit = satu hal kecil yang jelas. Jangan refactor besar tanpa diminta.
- **Jangan bikin file/abstraksi baru kalau belum perlu.** Tambah kompleksitas hanya saat dibutuhkan.
- **Vertical slice dulu.** Buat satu alur jalan end-to-end (ingest → DB → API → UI) sebelum melebar ke fitur lain.
- **Konfirmasi sebelum**: nambah dependency, ganti skema DB, ganti pola arsitektur, atau hapus kode.
- **Jangan commit secret.** API key OpenDota, Supabase service key, dll lewat env var (`.env.local`, GitHub Secrets). Cek `.gitignore`.
- **Sebut asumsi.** Kalau ada yang ambigu, tulis asumsinya di komentar/PR, jangan diam-diam nebak.

## 5. Skema database (ringkas)

Tabel **mentah** (salinan slim OpenDota):
`patches`, `leagues`, `teams`, `players`, `heroes`, `matches`, `picks_bans`, `match_players`.

Tabel **hitungan** (derived, di-rebuild dari sumber):
`tournament_hero_stats`, `team_hero_stats`, `hero_pairs` (kanonik `hero_id_a < hero_id_b`), `hero_role_dist`, `team_player_roles` (roster kanonik per tim dari STRATZ: `team_id, account_id, position 1-5, raw_position, is_active` — `account_id` TANPA FK ke `players` krn roster superset), plus `ingest_state` (watermark).

Kolom STRATZ-derived di `match_players`: `lane_result` (win-lane @~10min, F2a). `position` per-match tetap net-worth-heuristik (`positions.ts`) — dipakai lane_result/drill; role KANONIK stabil per pemain ada di `team_player_roles` (UI group pool pakai ini, bukan per-match position).

DDL lengkap ada di `schema.sql` (CREATE TABLE + index + RLS read-only). Skema = sumber kebenaran; jangan drift dari situ tanpa update file ini + PRD.

## 6. Aturan data eksternal

- **OpenDota**: sumber utama (telemetry + feed). Pakai API key gratis (env). Hormati ~60 req/menit; throttle worker. `POST /request` (parse) = 10 call, hemat-hemat (Fase 2 saja).
- **STRATZ** (GraphQL, `STRATZ_TOKEN` env): sumber KEDUA. Dipakai worker buat (a) `lane_result` backfill per-player (`stratz.ts`, F2a), (b) roster kanonik `team.members[].proSteamAccount.position` → `team_player_roles` (`roster.ts`, `POSITION_n→n`, `is_active` dari `teamId`). Throttle ~1.9s/req (2000/jam). Header `User-Agent: STRATZ_API`.
- **Liquipedia**: struktur/kalender/roster + bracket. Status project = edukasi/personal → boleh LPDB API gratis, tapi **wajib caching + atribusi CC-BY-SA**. Jangan spam request. (Roster sekarang dari STRATZ, bukan Liquipedia.)
- **Dotabuff**: default **tidak dipakai** (OQ-5) — cuma dipakai sebagai link keluar (match detail). Jangan bangun scraper Dotabuff.

## 7. Fase

- **F1 (MVP)** — ✅ jalan: FR-1..FR-8 — agregat turnamen/tim, player stats, match drill-down, kombinasi pair/trio, scouting ban (conditional pick→ban pakai **lift** ter-smoothing, bukan raw count), pick probability, role distribution.
- **F2a** — ✅ FR-9 winning lane: `lane_result` di-backfill dari STRATZ (bukan parse OpenDota).
- **F2b**: FR-10 timing objektif, FR-11 pola pergerakan (butuh event timeline / replay parser). Belum.

UI sekarang produk utuh: home (search team+hero + entry blok), nav (Home/Teams/Tournaments/Matches/Patches), list pages, team detail (last-10, hero pool by role kanonik, role-duo, lane matchup, conditional-ban, export PDF client-side light), halaman hero & player. Jangan kerjakan F2b sebelum diminta.

## 8. Definition of done (per fitur)

- Data benar (spot-check vs OpenDota/STRATZ untuk minimal 1 sample).
- Win rate selalu tampil dengan sample size.
- UI ikut `DESIGN.md` (dark modern).
- Tidak ada call eksternal dari front-end.
- Tidak ada secret ke-commit.
