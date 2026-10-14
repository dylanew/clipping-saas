import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/supabase/server";
import "./globals.css";

export const metadata: Metadata = { title: "Clipping", description: "Turn long videos into vertical clips" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en">
      <body>
        <header className="top">
          <Link href="/" className="brand">Clipping</Link>
          {user && (
            <form action="/auth/signout" method="post" className="account">
              <span className="muted small">{user.email}</span>
              <button type="submit" className="link">Sign out</button>
            </form>
          )}
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
