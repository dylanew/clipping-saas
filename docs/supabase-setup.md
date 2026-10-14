# Supabase setup

One-time settings in the Supabase dashboard for sign-in. Repeat the redirect URL step for each new
address the app runs on (for example the live site in slice 5).

## 1. Keys for `.env.local`
Project Settings > API Keys. Copy into `.env.local`:

    NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...

The publishable key is meant to be public. The secret key (`sb_secret_...`) is for the worker only
(slice 3) and must never go in a `NEXT_PUBLIC_` variable.

## 2. Where sign-in may send people back to
Authentication > URL Configuration:
- Site URL: `http://localhost:3000`
- Redirect URLs: add `http://localhost:3000/auth/callback`

## 3. Google sign-in
In Google Cloud Console (console.cloud.google.com):
1. Create a project (any name, e.g. "Clipping").
2. APIs & Services > OAuth consent screen: User type External, app name, your email as support and
   developer contact. Add your own Google account under Test users while the app is in testing.
3. APIs & Services > Credentials > Create credentials > OAuth client ID > Web application.
   Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`
   (Supabase shows this exact URL on its Google provider page).
4. Copy the Client ID and Client secret.

Back in Supabase: Authentication > Sign In / Providers > Google: turn it on, paste both, save.

## 4. Email links
Email sign-in works out of the box, but Supabase's built-in sender only allows a few emails an hour.
That is fine for testing; before inviting testers, set up a real email sender (Authentication > SMTP).
