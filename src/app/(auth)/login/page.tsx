"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, KeyRound, LogIn } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { AuthShell } from "@/components/auth/AuthShell";
import { SocialButtons } from "@/components/auth/SocialButtons";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [error, setError] = useState("");

  async function signInEmail(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await authClient.signIn.email({ email, password, rememberMe: true });
    setLoading(false);
    if (error) {
      setError(error.message || "Invalid email or password.");
      return;
    }
    router.push("/dashboard");
  }

  async function signInPasskey() {
    setError("");
    setPasskeyLoading(true);
    try {
      const res = await authClient.signIn.passkey();
      if (res?.error) {
        setError(res.error.message || "Passkey sign-in failed.");
      } else {
        router.push("/dashboard");
      }
    } catch {
      setError("No passkey available on this device.");
    }
    setPasskeyLoading(false);
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your CAPRO dashboard."
      footer={
        <>
          New to CAPRO?{" "}
          <Link href="/register" className="text-[var(--color-gold-soft)] hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <SocialButtons callbackURL="/dashboard" />

      <button
        type="button"
        onClick={signInPasskey}
        disabled={passkeyLoading}
        className="btn-outline mt-2.5"
      >
        {passkeyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
        Sign in with a passkey
      </button>

      <div className="my-5 flex items-center gap-3 text-xs text-[var(--color-ink-faint)]">
        <span className="h-px flex-1 bg-[var(--color-slate-line)]" />
        or with email
        <span className="h-px flex-1 bg-[var(--color-slate-line)]" />
      </div>

      <form onSubmit={signInEmail} className="space-y-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="fld"
        />
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="fld"
        />
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-xs text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]">
            Forgot password?
          </Link>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button type="submit" disabled={loading} className="btn-gold">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
          Sign in
        </button>
      </form>
    </AuthShell>
  );
}
