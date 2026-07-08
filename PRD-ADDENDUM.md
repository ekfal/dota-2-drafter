# PRD Addendum — state terbaru (di atas Dota2_Draft_Helper_PRD.docx v0.4)

`Dota2_Draft_Helper_PRD.docx` = binary, susah di-edit aman. Delta implementasi sejak v0.4 dicatat di sini (markdown). Kalau konflik: PRD.docx menang untuk scope/intent; file ini menang untuk *state implementasi terkini*.

_Update: 2026-07-08._

## Sumber data
- **OpenDota** — feed + telemetry slim (tak berubah).
- **STRATZ** (GraphQL, `STRATZ_TOKEN`) — sumber KEDUA, ditambahkan:
  - `lane_result` per-player (win-lane @~10min) → memenuhi **FR-9** tanpa parse OpenDota. Worker `stratz.ts`, watermark `stratz_cursor`. ~8000 baris ke-set.
  - **Roster kanonik** `team.members[].proSteamAccount.position` (`POSITION_n → n`, `is_active` = `proSteamAccount.teamId == team`). Worker `roster.ts`, tabel `team_player_roles`, TTL 7 hari + flag `--force` / `--team <id>` / `--dry-run`.
- **Liquipedia** — belum dipakai (roster sekarang dari STRATZ).
- **Dotabuff/STRATZ** — link keluar match detail saja.

## Skema (tambahan atas §5)
- `team_player_roles(team_id, account_id, name, position 1-5, raw_position, is_active, updated_at)`. `account_id` **tanpa FK** ke `players` (roster superset — main bisa 0 game di data). Derived, rebuildable dari STRATZ.

## Role / posisi (revisi penting)
- `match_players.position` per-match (heuristik net-worth, `positions.ts`) **tidak stabil** antar game (offlane kadang out-farm carry → role flip). Tetap dipakai untuk `lane_result` + drill-down.
- **Role KANONIK per (tim, pemain)** = sumber tampilan pool by position:
  - Primary: `team_player_roles` aktif (STRATZ).
  - Fallback (tim tanpa roster STRATZ): **Method C** on-the-fly — core/support split by median net-worth, mid/carry/off by `lane_role` mode.
  - Standin di-klasifikasi ke posisi yang **beneran dimainin** (per-match position mode), bukan role global STRATZ-nya.
  - Main resmi 0 game + ada standin berdata → standin di-promote jadi baris utama, main resmi tetap disebut di label.

## FR yang berubah bentuk
- **FR-6 conditional pick→ban**: metrik = **lift ter-smoothing** `P(ban Y|pick X)/P(ban Y)` (shrink ke baseline, K=5), bukan raw count (raw count nyesatin = meta-ban selalu di atas). Scope all-time team-wide. Gate pick ≥4 (reliable ≥8, di bawah = indikatif/diredam), co ≥2. Urut lift desc.

## UI (produk utuh, dark modern per DESIGN.md)
- **Home**: search global (team+hero) + entry blok (Top Teams by Elo, Tournaments, Latest patches).
- **Nav**: Home / Teams / Tournaments / Matches / Patches (Players nanti).
- **List pages**: Teams (grid kartu logo+nama+W-L), Tournaments (nama+tanggal+match count), Patches (+ chip turnamen).
- **Team detail** urutan: header → **Last 10 matches** → hero pool by role kanonik → role-duo (safe 1+5, off 3+4) + lane matchup vs lawan + conditional-ban → most pick/ban + winrate.
- **Export PDF**: client-side `html2pdf.js`, DOWNLOAD file (bukan print dialog), override ke **light/putih** sebelum capture, exclude nav/filter/tombol, multi-page, `team-{nama}-{patch}.pdf`. Risiko: portrait cross-origin (CORS) bisa blank.
- Halaman **hero** `/heroes/[id]` + **player** `/players/[account_id]`.

## Known issue
- `players.team_id` + `is_pro` kosong (0/1090) — worker OpenDota belum tarik; roster/pro info diambil dari STRATZ (`team_player_roles`) sebagai gantinya.
