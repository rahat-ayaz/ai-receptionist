"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, ArrowRight, Mail, Phone, CheckCircle2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { AuthShell } from "@/components/auth/AuthShell";
import { SocialButtons } from "@/components/auth/SocialButtons";
import { OtpInput } from "@/components/auth/OtpInput";
import { NICHE_OPTIONS } from "@/lib/niche";

type Step = "details" | "email" | "phone" | "done";

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("details");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [niche, setNiche] = useState("RESTAURANT");

  const [emailCode, setEmailCode] = useState("");
  const [phoneCode, setPhoneCode] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  // Step 1 → create account, then send email verification code.
  async function submitDetails(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const signUp = await authClient.signUp.email({ name, email, password });
    if (signUp.error) {
      setLoading(false);
      setError(signUp.error.message || "Could not create account.");
      return;
    }

    const sent = await authClient.emailOtp.sendVerificationOtp({ email, type: "email-verification" });
    setLoading(false);
    if (sent.error) {
      setError(sent.error.message || "Could not send verification code.");
      return;
    }
    setNote("We sent a 6-digit code to your email.");
    setStep("email");
  }

  // Step 2 → verify email code, then send phone code.
  async function verifyEmail(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await authClient.emailOtp.verifyEmail({ email, otp: emailCode });
    if (res.error) {
      setLoading(false);
      setError(res.error.message || "Invalid or expired code.");
      return;
    }

    // Ensure we have an active session before associating the phone number.
    const session = await authClient.getSession();
    if (!session.data) {
      await authClient.signIn.email({ email, password, rememberMe: true });
    }

    const sent = await authClient.phoneNumber.sendOtp({ phoneNumber: phone });
    setLoading(false);
    if (sent.error) {
      setError(sent.error.message || "Could not send SMS code.");
      return;
    }
    setNote("We sent a 6-digit code to your phone.");
    setStep("phone");
  }

  // Step 3 → verify phone code → done.
  async function verifyPhone(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await authClient.phoneNumber.verify({
      phoneNumber: phone,
      code: phoneCode,
      updatePhoneNumber: true,
    });
    setLoading(false);
    if (res.error) {
      setError(res.error.message || "Invalid or expired code.");
      return;
    }
    setStep("done");
    // Carry the chosen niche into onboarding, which creates the BusinessProfile.
    setTimeout(() => router.push(`/onboarding?niche=${encodeURIComponent(niche)}`), 1600);
  }

  return (
    <AuthShell
      title={
        step === "details"
          ? "Create your account"
          : step === "email"
            ? "Verify your email"
            : step === "phone"
              ? "Verify your phone"
              : "You're all set"
      }
      subtitle={
        step === "details"
          ? "Get your AI receptionist live in minutes."
          : step === "email"
            ? `Enter the code sent to ${email}.`
            : step === "phone"
              ? `Enter the code sent to ${phone}.`
              : undefined
      }
      footer={
        step === "details" ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="text-[var(--color-gold-soft)] hover:underline">
              Sign in
            </Link>
          </>
        ) : undefined
      }
    >
      {step === "details" && (
        <>
          <SocialButtons callbackURL="/onboarding" />
          <div className="my-5 flex items-center gap-3 text-xs text-[var(--color-ink-faint)]">
            <span className="h-px flex-1 bg-[var(--color-slate-line)]" />
            or with email
            <span className="h-px flex-1 bg-[var(--color-slate-line)]" />
          </div>
          <form onSubmit={submitDetails} className="space-y-3">
            <input className="fld" required placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="fld" required type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="fld" required type="password" minLength={8} placeholder="Password (min 8 chars)" value={password} onChange={(e) => setPassword(e.target.value)} />
            <input className="fld" required type="tel" placeholder="Phone (e.g. +15145550123)" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-[var(--color-ink-dim)]">What kind of business is this?</span>
              <select className="fld" value={niche} onChange={(e) => setNiche(e.target.value)}>
                {NICHE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button type="submit" disabled={loading} className="btn-gold">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              Continue
            </button>
          </form>
        </>
      )}

      {step === "email" && (
        <form onSubmit={verifyEmail} className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-[var(--color-gold-soft)]">
            <Mail className="h-4 w-4" /> {note}
          </div>
          <OtpInput value={emailCode} onChange={setEmailCode} />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button type="submit" disabled={loading || emailCode.length < 6} className="btn-gold">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Verify email
          </button>
          <button
            type="button"
            onClick={() => authClient.emailOtp.sendVerificationOtp({ email, type: "email-verification" })}
            className="w-full text-center text-xs text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]"
          >
            Resend code
          </button>
        </form>
      )}

      {step === "phone" && (
        <form onSubmit={verifyPhone} className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-[var(--color-gold-soft)]">
            <Phone className="h-4 w-4" /> {note}
          </div>
          <OtpInput value={phoneCode} onChange={setPhoneCode} />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button type="submit" disabled={loading || phoneCode.length < 6} className="btn-gold">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Verify phone
          </button>
          <button
            type="button"
            onClick={() => authClient.phoneNumber.sendOtp({ phoneNumber: phone })}
            className="w-full text-center text-xs text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]"
          >
            Resend code
          </button>
        </form>
      )}

      {step === "done" && (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CheckCircle2 className="h-12 w-12 text-[var(--color-gold)]" />
          <p className="text-sm text-[var(--color-ink-dim)]">
            Email and phone verified. Taking you to setup…
          </p>
        </div>
      )}
    </AuthShell>
  );
}
