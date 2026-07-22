# DESIGN.md — Dota 2 Draft Helper UI (v3, Dota HUD)

**Arah: "Dota HUD" — gold + black + red, nuansa khas Dota 2.** Ganti generic-dark yang lama
(terlalu "AI-default": biru + card + rounded). Aesthetic ini immersive & on-brand buat penggemar
Dota, tapi tetap modern & padat buat baca data cepat. Portrait hero tetap unit visual utama,
per posisi. UI **wajib** ikut file ini.

## 0. Aturan emas

- **Portrait hero = unit visual utama**, disusun per posisi (1-5). Full pool, bukan top-3.
- **Palet Dota: gold + hitam + merah.** Bukan biru-generic. Warna ini yang bikin nggak "AI banget".
- **Semua clickable & saling nyambung** (team <-> tournament <-> player <-> match <-> hero).
- **Visual di atas, tabel/chart di bawah.**
- **Padat tapi lega.** Nuansa in-game HUD: gelap-hangat, aksen gold, garis tegas.

## 1. Warna (Dota HUD)

    --bg:            #0d0b09   base, gelap-hangat (bukan biru-hitam)
    --surface:       #16120e   panel
    --surface-2:     #1e1813   raised / hover
    --border:        #2a2118   garis panel (warm dark)
    --border-gold:   #3a2f1e   garis aksen redup
    --gold:          #c8aa6e   PRIMARY aksen — header, link aktif, highlight (Dota UI gold)
    --gold-bright:   #e4c885   gold terang (hover, judul penting)
    --text:          #e8e0d4   teks utama (warm off-white, bukan putih biru)
    --text-muted:    #9a8f7e   teks sekunder (warm grey)
    --text-dim:      #6a6152   label, hint
    --dire:          #c8493a   merah (Dire, loss, danger, ban)
    --radiant:       #92a525   hijau-olive (Radiant, win) — hijau khas Dota, bukan hijau neon
    --neutral:       #8a7a5e   winrate netral / no-data (warm)

Aturan pakai:
- **--gold** = identitas + semua clickable/aktif (link, tab aktif, header section, tombol utama).
- **--radiant (hijau-olive) / --dire (merah)** = winrate & win/loss. >=55% radiant, 45-55% neutral,
  <45% dire. SELALU + sample size. (Pakai hijau-olive Dota, bukan #3fb950 neon.)
- Merah (--dire) juga buat ban & danger. Jangan pakai biru sama sekali (itu yang bikin generic).
- Background gelap-HANGAT (#0d0b09), bukan gelap-biru (#0e1116). Ini kunci mood Dota.

## 2. Tipografi

Font: "Inter", system-ui, sans-serif (badan). Boleh 1 display font berkarakter buat header besar
(mis. "Oswald"/condensed bold) kalau gampang — tegas, sedikit "esports". Kalau nggak, Inter 800.

| Token | Size | Weight | Pakai |
|---|---|---|---|
| display | 22px | 800 | Nama team/turnamen (gold-bright) |
| h2 | 15px | 700 | Judul section, uppercase, gold, letter-spacing 0.04em |
| label | 12px | 700 | Label posisi/kolom, uppercase, text-muted |
| body | 13-14px | 400 | Isi |
| stat | 11px | 500 | Angka di portrait (games/WL), warm |

Header section boleh ada ornamen kecil khas Dota (◆ / garis gold) — subtle, jangan norak.

## 3. Layout & spacing

- Dashboard, lebar ~1100-1200px, center.
- Panel: --surface, border 1px --border, radius 2-4px (TAJAM, bukan rounded 8px — HUD feel).
  Header panel boleh border-top 2px --gold (aksen HUD).
- Gap 12px, rhythm section 16-24px.
- Mobile: kolom collapse, portrait grid wrap.

## 4. Sistem portrait hero (inti)

- Sumber: heroes.img (CDN Steam). <img>, jangan download.
- Tile: landscape ~46x26 atau 52x30, radius 2px (tajam), border 1px --border-gold.
- **Border bawah 3px = winrate** (--radiant / --neutral / --dire).
- Label bawah: W-L (win%) format "3-1 (75%)", warm muted.
- Hover: nama hero + WR% + games (tooltip). Portrait = link ke hero.

## 5. Komponen

### team-header
Logo (radius 2px, border gold-redup) + nama (display, gold-bright) + region + rekor W-L
(radiant/dire) + Elo. Tombol Export PDF (gold). Chip turnamen (clickable, border gold-redup).

### position-pool (BINTANG)
5 baris POS 1-5. Label posisi (gold) + nama player (link) + deretan portrait full pool.
Header panel border-top gold. Baris pakai --surface, aksen kiri gold-redup opsional.

STANDIN (PENTING — perbaiki yang sekarang jelek):
- Kalau player = main resmi → TANPA label apa pun.
- Kalau standin → badge kecil "STANDIN" (uppercase, 10px, warna --dire redup / background redup),
  BUKAN kalimat panjang. Detail ("main resmi X belum ada game") → TOOLTIP di badge, jangan teks
  inline yang kepanjangan/kepotong.

### data-table (sekunder, bawah)
Header --surface-2 + label gold uppercase. Baris border-bottom --border. Angka rata kanan,
diwarnai radiant/dire. Nama = link + portrait kecil.

### chart (sekunder)
Warna dari palet (radiant/dire/gold). Flat. Selalu + sample size.

### chip / badge
Pill radius 3px, --surface + border --border-gold, teks muted. Hover → gold.
Badge STANDIN: kecil, --dire redup, uppercase.

### nav / breadcrumb
Breadcrumb tiap halaman, segmen = link gold. Global nav: Home · Teams · Tournaments · Matches ·
Patches. Tab aktif = gold underline/highlight.

## 6. Clickability (nav graph)
Team -> chip turnamen -> tournament. Team -> player. Team/tournament -> match. Portrait -> hero.
Match -> kedua team. Semua nyambung, nggak ada dead-end.

## 7. Teams list
Grid kartu (logo + nama + rekor W-L). Search atas. Nanti group per region. Hover kartu = border gold.

## 8. Do / Don't

**Do**
- Gold + hitam-hangat + merah/hijau-olive. Portrait hero bahasa utama.
- Sudut tajam (radius 2-4px), aksen gold di header panel. Nuansa HUD Dota.
- Winrate radiant/dire + sample size.
- Standin = badge kecil + tooltip.

**Don't**
- JANGAN biru aksen (itu yang bikin "AI banget"). Gold gantinya.
- Jangan rounded 8px+ / card generic. Tajam + HUD.
- Jangan background gelap-BIRU; pakai gelap-HANGAT (#0d0b09).
- Jangan kalimat panjang inline (standin dsb) — badge + tooltip.
- Jangan hijau neon; hijau-olive Dota (#92a525).
- Jangan dead-end.
