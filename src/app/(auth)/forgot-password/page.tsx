"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Mail, CheckCircle2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { AuthShell } from "@/components/auth/AuthShell";
import { OtpInput } from "@/components/auth/OtpInput";

type Step = "request" | "reset" | "done";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: "forget-password" });
    setLoading(false);
    if (error) {
      setError(error.message || "Could not send reset code.");
      return;
    }
    setStep("reset");
  }

  async function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await authClient.emailOtp.resetPassword({ email, otp: code, password });
    setLoading(false);
    if (error) {
      setError(error.message || "Invalid or expired code.");
      return;
    }
    setStep("done");
    setTimeout(() => router.push("/login"), 1600);
  }

  return (
    <AuthShell
      title={step === "done" ? "Password updated" : "Reset your password"}
      subtitle={
        step === "request"
          ? "Enter your email and we'll send a reset code."
          : step === "reset"
            ? `Enter the code sent to ${email} and choose a new password.`
            : undefined
      }
      footer={
        step !== "done" ? (
          <Link href="/login" className="text-[var(--color-gold-soft)] hover:underline">
            Back to sign in
          </Link>
        ) : undefined
      }
    >
      {step === "request" && (
        <form onSubmit={requestCode} className="space-y-3">
          <input className="fld" required type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button type="submit" disabled={loading} className="btn-gold">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Send reset code
          </button>
        </form>
      )}

      {step === "reset" && (
        <form onSubmit={resetPassword} className="space-y-4">
          <OtpInput value={code} onChange={setCode} />
          <input className="fld" required type="password" minLength={8} placeholder="New password (min 8 chars)" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button type="submit" disabled={loading || code.length < 6} className="btn-gold">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Update password
          </button>
        </form>
      )}

      {step === "done" && (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CheckCircle2 className="h-12 w-12 text-[var(--color-gold)]" />
          <p className="text-sm text-[var(--color-ink-dim)]">Your password was updated. Redirecting to sign in…</p>
        </div>
      )}
    </AuthShell>
  );
}
