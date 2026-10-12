import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { title: "Clipping", description: "Turn long videos into vertical clips" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <Link href="/" className="brand">Clipping</Link>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
