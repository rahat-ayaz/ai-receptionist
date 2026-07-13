"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Mail, Phone, CheckCircle2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { AuthShell } from "@/components/auth/AuthShell";
import { OtpInput } from "@/components/auth/OtpInput";

function VerifyPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get("redirect") || "/dashboard";

  const { data: session, isPending: sessionLoading, refetch } = authClient.useSession();

  const [email, setEmail] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [phoneCode, setPhoneCode] = useState("");

  const [step, setStep] = useState<"loading" | "email" | "phone" | "done">("loading");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (sessionLoading) return;

    if (!session) {
      router.push(`/login?redirect=/verify`);
      return;
    }

    const user = session.user;
    setEmail(user.email);
    setPhoneNumber(user.phoneNumber || "");

    if (!user.emailVerified) {
      setStep("email");
      sendEmailOtpCode(user.email);
    } else if (!user.phoneNumberVerified || !user.phoneNumber) {
      setStep("phone");
    } else {
      setStep("done");
      router.push(redirectPath);
    }
  }, [session, sessionLoading]);

  async function sendEmailOtpCode(targetEmail: string) {
    setError("");
    setNote("Sending email code...");
    const res = await authClient.emailOtp.sendVerificationOtp({
      email: targetEmail,
      type: "email-verification",
    });
    if (res.error) {
      setError(res.error.message || "Failed to send code.");
      setNote("");
    } else {
      setNote(`Verification code sent to ${targetEmail}`);
    }
  }

  async function verifyEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!emailCode || emailCode.length < 6) {
      setError("Please enter a 6-digit verification code.");
      return;
    }
    setError("");
    setLoading(true);

    const res = await authClient.emailOtp.verifyEmail({ email, otp: emailCode });
    setLoading(false);

    if (res.error) {
      setError(res.error.message || "Invalid code.");
    } else {
      await refetch(); // Reload session state
    }
  }

  async function sendPhoneOtpCode(e: React.FormEvent) {
    e.preventDefault();
    if (!phoneNumber) {
      setError("Please enter a valid phone number.");
      return;
    }
    setError("");
    setLoading(true);
    setNote("Sending phone code...");

    const res = await authClient.phoneNumber.sendOtp({ phoneNumber });
    setLoading(false);

    if (res.error) {
      setError(res.error.message || "Failed to send phone code.");
      setNote("");
    } else {
      setNote(`Verification code sent to ${phoneNumber}`);
    }
  }

  // The phone belongs to an existing account (e.g. an expired trial) — the
  // path forward is signing in, not re-registering.
  const phoneAlreadyRegistered = /exist/i.test(error);

  async function verifyPhone(e: React.FormEvent) {
    e.preventDefault();
    if (!phoneCode || phoneCode.length < 6) {
      setError("Please enter a 6-digit verification code.");
      return;
    }
    setError("");
    setLoading(true);

    const res = await authClient.phoneNumber.verify({
      phoneNumber,
      code: phoneCode,
      updatePhoneNumber: true,
    });
    setLoading(false);

    if (res.error) {
      const msg = res.error.message || "Invalid code.";
      setError(msg);
      // Don't leave a stale "code sent" note under an account-conflict error.
      if (/exist/i.test(msg)) setNote("");
    } else {
      setStep("done");
      await refetch();
      router.push(redirectPath);
    }
  }

  if (step === "loading" || sessionLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-midnight)]">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--color-gold)]" />
      </div>
    );
  }

  return (
    <AuthShell
      title={step === "email" ? "Verify your email" : step === "phone" ? "Verify your phone" : "Verification complete"}
      subtitle={
        step === "email"
          ? "We sent a 6-digit code to your inbox."
          : step === "phone"
            ? "Enter your phone number to receive a verification code."
            : "You will be redirected shortly."
      }
    >
      {error && (
        <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/20 p-3.5 text-sm text-red-400">
          {error}
          {phoneAlreadyRegistered && (
            <>
              <p className="mt-2 text-[var(--color-ink-dim)]">
                This number is already linked to a CAPRO account. If it&apos;s yours, sign in with that
                account instead — if its trial has expired, you&apos;ll be taken straight to billing to
                reactivate it.
              </p>
              <Link
                href="/login"
                className="mt-2 inline-block font-semibold text-[var(--color-gold)] hover:underline"
              >
                Sign in to your account →
              </Link>
            </>
          )}
        </div>
      )}
      {note && <div className="mb-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3.5 text-sm text-emerald-400">{note}</div>}

      {step === "email" && (
        <form onSubmit={verifyEmail} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Verification Code</label>
            <div className="mt-2 flex justify-center">
              <OtpInput length={6} value={emailCode} onChange={setEmailCode} />
            </div>
          </div>
          <button
            type="submit"
            disabled={loading || emailCode.length < 6}
            className="w-full btn btn-primary flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Verify email
          </button>
          <div className="text-center text-xs">
            <button type="button" onClick={() => sendEmailOtpCode(email)} className="text-[var(--color-gold-soft)] hover:underline">
              Resend verification code
            </button>
          </div>
        </form>
      )}

      {step === "phone" && (
        <form onSubmit={phoneCode ? verifyPhone : sendPhoneOtpCode} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Phone Number</label>
            <div className="relative mt-1.5 rounded-lg shadow-sm">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <Phone className="h-4 w-4 text-[var(--color-ink-dim)]" />
              </div>
              <input
                type="tel"
                required
                disabled={!!note}
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+1 (555) 000-0000"
                className="fld pl-9"
              />
            </div>
          </div>

          {note && (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">SMS Verification Code</label>
              <div className="mt-2 flex justify-center">
                <OtpInput length={6} value={phoneCode} onChange={setPhoneCode} />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || (!!note && phoneCode.length < 6)}
            className="w-full btn-gold flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {note ? "Verify phone" : "Send code"}
          </button>

          {note && (
            <div className="text-center text-xs">
              <button
                type="button"
                onClick={() => {
                  setPhoneCode("");
                  setNote("");
                }}
                className="text-[var(--color-gold-soft)] hover:underline"
              >
                Change phone number
              </button>
            </div>
          )}
        </form>
      )}

      {step === "done" && (
        <div className="py-6 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" />
          <p className="mt-3 text-sm text-[var(--color-ink-dim)]">Redirecting you to dashboard...</p>
        </div>
      )}
    </AuthShell>
  );
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--color-midnight)]">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--color-gold)]" />
        </div>
      }
    >
      <VerifyPageContent />
    </Suspense>
  );
}
