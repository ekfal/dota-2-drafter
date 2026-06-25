# DESIGN.md — Dota 2 Draft Helper UI

Aesthetic: **catalog-era retro (Dell ~1996)**, dirampingkan ke dua warna inti — **black + sky**.
Vibe: bingkai hitam tegas, kartu flat warna sky, tipografi tebal, sudut tajam, tanpa shadow lembut.
UI **wajib** ikut file ini. Kalau ragu: flat, square, bordered.

## 0. Aturan emas (jangan dilanggar)

- **Page frame hitam** mengelilingi seluruh viewport. Ini chrome paling khas — jangan dihapus.
- **Flat color block**, bukan gradient/opacity/soft-shadow. Depth cue cuma: border 1px atau bevel keras.
- **Sudut tajam** (`radius: 0`) untuk semua — kartu, tombol, input, banner. Pengecualian satu-satunya: seal bulat (`radius: 9999px`).
- **Serif untuk body, sans untuk UI.** Kebalikan web modern — ini sengaja.
- **Sky = satu-satunya tint.** Jangan tambah warna aksen di luar palet di §1.

## 1. Warna (palet tertutup)

```css
:root {
  --frame-ink:   #000000; /* frame, banner, border, button fill, semua hairline */
  --canvas:      #ffffff; /* surface di dalam frame, title bar kartu */
  --ink:         #000000; /* teks body & heading */
  --sky:         #9ab6c8; /* SATU-SATUNYA tint: body kartu, blok aksen, header tabel */
  --sky-deep:    #5e7d8f; /* teks di atas sky / garis aksen (turunan sky) */
  --link:        #0000ee; /* anchor underline klasik Mosaic/Netscape */
  --link-visited:#551a8b;
}
```

Aturan pakai:
- `--sky` = identitas warna. Dipakai untuk: body "ribbon card", header tabel, blok eyebrow section, badge.
- `--frame-ink` = struktur. Frame, banner atas, fill tombol primary, semua border 1px.
- Teks di atas `--sky` pakai `--ink` (hitam) — kontras cukup. `--sky-deep` untuk teks sekunder/garis.
- **Dell red dibuang.** Tidak ada merah. Kalau butuh "urgent", pakai banner hitam + teks putih, bukan warna baru.

## 2. Tipografi

Font stack OS-default (tanpa webfont, demi autentik):

```css
--font-display: "Arial Black", Helvetica, sans-serif; /* heading tebal */
--font-ui:      Helvetica, Arial, sans-serif;         /* title baris, label, tombol */
--font-body:    "Times New Roman", Times, serif;      /* SEMUA body copy */
```

| Token | Size | Weight | Font | Pakai |
|---|---|---|---|---|
| display | 36px | 900 | display | Eyebrow section (mis. "TEAM RANKINGS", all-caps) |
| h1 | 24px | 900 | display | Hero sub-halaman |
| h2 | 16px | 700 | ui | Banner copy, judul baris produk/entitas (all-caps) |
| h3 | 14px | 700 | ui | Title bar kartu (mis. "TEAM SPIRIT", "OPTIPLEX GX" → di kita: nama team/hero) |
| body | 14px | 400 | body | Paragraf, isi kartu, angka stat |
| body-sm | 12px | 400 | body | Catatan kecil, "best viewed..." vibe |
| caption | 11px | 400 | body | Copyright footer |
| button | 12px | 700 | ui | Label tombol, sticker |
| ui-label | 12px | 700 | ui | Label nav uppercase |

Prinsip: heading selalu **berat ekstrem** (900/Black) all-caps. Body Times Roman 14, jangan diganti sans. Tanpa letter-spacing.

## 3. Spacing & layout

- Base unit 4px. Token: 2 / 4 / 6 / 8 / 10 / 12 / 16 / 20 / 24 / 32 / 40 / 48.
- Padding interior kartu: 12px vertikal / 16px horizontal.
- Rhythm antar-stack section: 40px; antara eyebrow dan kartu pertama: 32px.
- **Container**: lebar tetap ~760px, di-center dengan gutter lebar di layar besar (kesan "spread majalah di tengah").
- Struktur dua kolom: rail kiri (~28%) buat nav/list ringkas; kolom kanan (~72%) buat stack konten utama.
- Whitespace rapat (catalog density). Napas didapat **di dalam** kartu (title bar putih + body sky), bukan dari memperbesar halaman.

## 4. Elevation (hanya 4 level, tanpa soft shadow)

| Level | Treatment | Pakai |
|---|---|---|
| 0 Flush | tanpa border/shadow | body text, footer band |
| 1 Hairline | `1px solid var(--frame-ink)` | tepi kartu, divider tabel |
| 2 Frame | `8px solid var(--frame-ink)` | bingkai halaman |
| 3 Bevel | highlight 1px + shadow 1px keras | sticker, seal, foto/thumbnail |

Bevel keras boleh via `filter: drop-shadow(2px 2px 0 #000)`. **Tidak ada** drop-shadow lembut / blur / glow.

## 5. Border radius

```css
--radius-none: 0;     /* default universal */
--radius-full: 9999px;/* hanya seal/badge bulat */
```

Tidak ada tier 4/8/12px. Square atau bulat, titik.

## 6. Komponen (dipetakan ke app kita)

### page-frame
Border hitam 8px keliling viewport. Halaman duduk di dalamnya. Mobile boleh turun ke 4px (≤768) / 2px (<480), tapi jangan dihapus.

### top-banner
Strip hitam penuh di atas. Kiri: judul app all-caps (h2, putih). Di kita pengganti "1-800-...DELL": slot kanan untuk **search** atau **patch selector** aktif (bukan nomor telepon). Padding 12/16, radius 0.

### section-eyebrow
Blok `--sky` besar berisi judul section all-caps (display 36/900, teks ink). Contoh: "TEAM RANKINGS", "MATCH DETAIL". Padding 24/16, radius 0.

### ribbon-card (komponen tanda tangan)
Tiga bagian bertumpuk:
1. **title bar** — bar putih (`--canvas`), nama entitas all-caps (h3, ink), border-bottom 1px hitam. Di kita: nama team / hero / player.
2. **body** — blok `--sky`, isi Times Roman 14 (stat, deskripsi). Padding 12/16, border 1px hitam, radius 0.
3. **thumb notch** — thumbnail (logo team / portrait hero) "ditakik" di ~25% kanan, sedikit keluar atas-bawah seperti foto dipin. Thumbnail tetap persegi + bevel keras; jangan di-`border-radius`.

Semua kartu berbagi chrome sama; yang berubah cuma isinya (warna tetap sky).

### data-table (penting buat tool kita)
- Header row: fill `--sky`, teks `--ink`, font ui-label 12/700 all-caps.
- Body row: `--canvas`, teks body 14 (Times). Divider antar-baris: 1px hitam tipis.
- Angka rata kanan; nama rata kiri. Win rate selalu dengan sample size kecil di sampingnya (body-sm).
- Tanpa zebra-stripe warna lain; cuma hairline hitam. Tanpa sudut bulat.

### stat-block
Untuk angka menonjol (win rate, pick count): label kecil (ui-label) di atas, angka besar (display/h1) di bawah, di dalam kartu sky atau putih. Flat.

### cta-banner (pengganti panel merah)
Karena merah dibuang: pesan ajakan utama pakai **banner hitam, teks putih** (body Times), border 1px. Maksimal satu per halaman.

### cert-seal / badge
Seal bulat (`--radius-full`), fill hitam atau sky, teks putih (button 12/700). Untuk penanda kecil (mis. "NEW PATCH", "TOP PICK"). Bevel keras opsional.

### nav (icon-label)
Baris nav bawah: ikon + label uppercase (ui-label). Di kita: FIND / TEAMS / MATCHES / HEROES. Background putih, dihubungkan garis tipis (boleh `--sky-deep`). Mobile: target sentuh minimal 44×44.

### button
- primary: fill hitam, teks putih (button 12/700 all-caps), border 1px hitam, radius 0.
- secondary: fill putih, teks hitam, border 1px hitam.
- text-link: anchor biru `--link`, underline, Times 14.

### input
Fill putih, border 1px hitam, Times 14, padding 4/6, radius 0.

### footer-band
Putih, border-top 1px hitam, copyright (caption 11), link biru klasik. Vibe "best viewed with..." boleh sebagai easter egg.

## 7. Responsif

| Width | Perubahan |
|---|---|
| ≥1280 | layout 760px center, gutter lebar |
| 768 | frame → 4px; kartu full-width; rail kiri jadi stack atas |
| <480 | frame → 2px; satu kolom; notch thumbnail jadi gambar full-width di atas; nav tetap 4-up |

## 8. Do / Don't

**Do**
- Pertahankan page-frame hitam di tiap halaman.
- Sky sebagai tint tunggal — konsisten di semua kartu/header.
- Heading display Arial Black 36/900 all-caps.
- Body Times Roman 14.
- Tombol & kartu radius 0. Bevel keras untuk thumbnail.

**Don't**
- Jangan tambah warna aksen di luar black / sky / canvas / ink / link-blue.
- Jangan bulatkan sudut (kecuali seal).
- Jangan ganti body Times Roman dengan sans/Inter/webfont.
- Jangan pakai soft shadow / gradient / glow.
- Jangan crop thumbnail dengan border-radius / clip-path — takik via layout, fotonya tetap persegi.
- Jangan dua banner CTA di satu halaman.
