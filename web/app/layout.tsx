import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dota 2 Draft Helper",
  description: "Analisis draft pro/tournament Dota 2.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        <div className="page-frame">
          {/* §6 top-banner: judul kiri, slot kanan (nanti: search / patch selector) */}
          <header className="top-banner">
            <h2>Dota 2 Draft Helper</h2>
            <span className="slot">PRO DRAFT ANALYSIS</span>
          </header>
          {children}
          <footer className="footer-band">
            Data: OpenDota. Best viewed with any browser.
          </footer>
        </div>
      </body>
    </html>
  );
}
