"use client";

import { useState, type ReactNode } from "react";

// Show/hide per section di team page. Default open. Section yang DITUTUP dapet .no-pdf →
// ke-exclude dari export PDF (user sembunyiin = gak mau ada di PDF juga).
export default function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={open ? undefined : "no-pdf"}>
      <div
        className="h2 sec-head"
        onClick={() => setOpen(!open)}
        role="button"
        aria-expanded={open}
        title={open ? "Klik untuk sembunyikan" : "Klik untuk tampilkan"}
      >
        <span className={`sec-chev ${open ? "open" : ""}`}>▸</span>
        {title}
      </div>
      {open ? children : null}
    </section>
  );
}
