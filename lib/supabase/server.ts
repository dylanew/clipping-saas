import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseEnv } from "./env";

/**
 * Supabase client for server components and route handlers, acting as the signed-in user
 * (their session lives in cookies). Create one per request; never share it between users.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = supabaseEnv();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server components can't set cookies; proxy.ts refreshes the session on every request instead.
        }
      },
    },
  });
}

/** The signed-in user's id and email, verified from their session, or null. */
export async function currentUser(): Promise<{ id: string; email?: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ? { id: data.claims.sub, email: data.claims.email } : null;
}
