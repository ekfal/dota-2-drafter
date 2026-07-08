import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dota 2 Draft Helper",
  description: "Analisis draft pro/tournament Dota 2.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        <nav className="app-nav">
          <div className="inner">
            <Link href="/" className="brand">
              Draft Helper
            </Link>
            <Link href="/">Home</Link>
            <Link href="/teams">Teams</Link>
            <Link href="/tournaments">Tournaments</Link>
            <Link href="/matches">Matches</Link>
            <Link href="/patches">Patches</Link>
          </div>
        </nav>
        {children}
        <footer className="footer">Data: OpenDota.</footer>
      </body>
    </html>
  );
}
