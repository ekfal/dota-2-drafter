"use client";

// Export PDF = print browser (Save as PDF). Zero dep. Client island kecil buat window.print.
export default function PrintButton() {
  return (
    <button type="button" className="btn-primary no-print" onClick={() => window.print()}>
      EXPORT PDF / PRINT
    </button>
  );
}
