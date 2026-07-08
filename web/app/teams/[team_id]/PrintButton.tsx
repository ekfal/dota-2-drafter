"use client";

import { useState } from "react";

// Export PDF: DOWNLOAD file (bukan print dialog). Client-side html2pdf.js (ringan, no server).
// Capture #pdf-region APA ADANYA (state expand saat klik), override ke LIGHT/putih sebelum capture
// (app dark → PDF hemat tinta), exclude .no-pdf (nav di luar main, filter, tombol export).
function slug(s: string): string {
  return (s || "team").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "team";
}

export default function PrintButton({ teamName, patchName }: { teamName: string; patchName?: string | null }) {
  const [busy, setBusy] = useState(false);

  async function onExport() {
    const el = document.getElementById("pdf-region");
    if (!el || busy) return;
    setBusy(true);
    el.classList.add("pdf-light");
    try {
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
    } finally {
      el.classList.remove("pdf-light");
      setBusy(false);
    }
  }

  return (
    <button type="button" className="btn-accent no-pdf no-print" onClick={onExport} disabled={busy}>
      {busy ? "Generating…" : "Export PDF"}
    </button>
  );
}
