import LoginForm from "./login-form";

export const metadata = { title: "Sign in · Clipping" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <div className="login">
      <h1>Sign in</h1>
      <p className="muted">New here? Signing in creates your account.</p>
      {error === "link" && <p className="error">That sign-in link has expired or was already used. Send yourself a new one.</p>}
      <LoginForm next={next} />
    </div>
  );
}
