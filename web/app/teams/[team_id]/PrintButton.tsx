"use client";

import { useState } from "react";

// Export PDF: DOWNLOAD file (bukan print dialog). Client-side html2pdf.js (ringan, no server).
// Capture #pdf-region APA ADANYA (state expand saat klik), override ke LIGHT/putih sebelum capture
// (app dark → PDF hemat tinta), exclude .no-pdf (nav di luar main, filter, tombol export).
//
// CORS: Steam CDN ACAO = https://www.dota2.com (bukan wildcard) → html2canvas gagal baca portrait.
// Fix: SEBELUM capture, swap semua <img> cross-origin ke /api/img (proxy same-origin, whitelist
// host), restore SETELAH capture. Proxy dipakai cuma pas export — UI normal tetap direct CDN.
function slug(s: string): string {
  return (s || "team").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "team";
}

// swap src cross-origin → proxy; balikin Map buat restore. Tunggu semua ke-load (biar capture gak kosong).
async function proxifyImages(el: HTMLElement): Promise<Map<HTMLImageElement, string>> {
  const orig = new Map<HTMLImageElement, string>();
  const waits: Promise<unknown>[] = [];
  for (const im of Array.from(el.querySelectorAll("img"))) {
    const src = im.getAttribute("src") ?? "";
    if (!src.startsWith("http") || src.startsWith(window.location.origin)) continue;
    orig.set(im, src);
    im.src = `/api/img?url=${encodeURIComponent(src)}`;
    waits.push(
      im.complete && im.naturalWidth > 0
        ? Promise.resolve()
        : new Promise((r) => {
            im.onload = r;
            im.onerror = r; // gagal load → biarin (kotak kosong 1 gambar > gagal total)
          })
    );
  }
  await Promise.all(waits);
  return orig;
}

export default function PrintButton({ teamName, patchName }: { teamName: string; patchName?: string | null }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onExport() {
    const el = document.getElementById("pdf-region");
    if (!el || busy) return;
    setBusy(true);
    setErr(null);
    el.classList.add("pdf-light");
    let orig: Map<HTMLImageElement, string> | null = null;
    try {
      orig = await proxifyImages(el);
      const html2pdf = (await import("html2pdf.js")).default;
      const filename = `team-${slug(teamName)}${patchName ? `-${slug(patchName)}` : ""}.pdf`;
      await html2pdf()
        .set({
          filename,
          margin: 8,
          image: { type: "jpeg", quality: 0.95 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            backgroundColor: "#ffffff",
            ignoreElements: (n: Element) => n.classList?.contains("no-pdf"),
          },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: { mode: ["css", "legacy"] },
        })
        .from(el)
        .save();
    } catch (e) {
      console.error("PDF export gagal:", e);
      setErr("Export gagal — coba lagi. Kalau berulang, cek console.");
    } finally {
      if (orig) for (const [im, src] of orig) im.src = src; // restore direct CDN
      el.classList.remove("pdf-light");
      setBusy(false);
    }
  }

  return (
    <span className="no-pdf no-print">
      <button type="button" className="btn-accent" onClick={onExport} disabled={busy}>
        {busy ? "Generating…" : "Export PDF"}
      </button>
      {err ? (
        <span className="dim" style={{ color: "var(--dire, #c23c2a)", fontSize: 12, marginLeft: 8 }}>
          {err}
        </span>
      ) : null}
    </span>
  );
}
