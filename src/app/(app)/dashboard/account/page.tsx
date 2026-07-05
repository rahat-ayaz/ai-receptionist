"use client";

import { useEffect, useState } from "react";
import { Loader2, User, Mail, Phone, Lock, CheckCircle2, ShieldAlert } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { OtpInput } from "@/components/auth/OtpInput";

type U = { name?: string | null; email: string; emailVerified?: boolean; phoneNumber?: string | null; phoneNumberVerified?: boolean };

export default function AccountPage() {
  const { data: session, isPending } = authClient.useSession();
  const user = session?.user as U | undefined;

  if (isPending) return <div className="px-5 py-6 text-sm text-[var(--color-ink-dim)] sm:px-8">Loading…</div>;
  if (!user) return <div className="px-5 py-6 text-sm text-[var(--color-ink-dim)] sm:px-8">Not signed in.</div>;

  return (
    <div className="w-full px-5 py-8 sm:px-8">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <User className="h-6 w-6 text-[var(--color-gold)]" /> Account
        </h1>
        <p className="mt-1 text-sm text-[var(--color-ink-dim)]">Manage your contact details and sign-in security.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <NameCard current={user.name ?? ""} />
        <EmailCard current={user.email} verified={!!user.emailVerified} />
        <PhoneCard current={user.phoneNumber ?? ""} verified={!!user.phoneNumberVerified} />
        <PasswordCard />
      </div>
    </div>
  );
}

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="tile p-6">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">{icon} {title}</h2>
      {children}
    </div>
  );
}
function Note({ kind, children }: { kind: "ok" | "err"; children: React.ReactNode }) {
  return <p className={`mt-3 text-sm ${kind === "ok" ? "text-emerald-400" : "text-red-400"}`}>{children}</p>;
}
function Verified({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> Verified</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs text-amber-400"><ShieldAlert className="h-3.5 w-3.5" /> Unverified</span>
  );
}

function NameCard({ current }: { current: string }) {
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  async function save() {
    setBusy(true); setMsg(null);
    const { error } = await authClient.updateUser({ name });
    setBusy(false);
    setMsg(error ? { k: "err", t: error.message || "Could not save." } : { k: "ok", t: "Saved." });
  }
  return (
    <Card icon={<User className="h-4 w-4 text-[var(--color-gold)]" />} title="Contact details">
      <label className="mb-1.5 block text-xs font-medium text-[var(--color-ink-dim)]">Full name</label>
      <input className="fld" value={name} onChange={(e) => setName(e.target.value)} />
      <button onClick={save} disabled={busy} className="btn-gold mt-4 !w-auto px-4">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
      </button>
      {msg && <Note kind={msg.k}>{msg.t}</Note>}
    </Card>
  );
}

function EmailCard({ current, verified }: { current: string; verified: boolean }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  async function change() {
    if (!email) return;
    setBusy(true); setMsg(null);
    const { error } = await authClient.changeEmail({ newEmail: email, callbackURL: "/dashboard/account" });
    setBusy(false);
    setMsg(error ? { k: "err", t: error.message || "Could not change email." } : { k: "ok", t: `Confirmation sent to ${current}. Click the link there to switch to ${email}.` });
    if (!error) setEmail("");
  }
  return (
    <Card icon={<Mail className="h-4 w-4 text-[var(--color-gold)]" />} title="Email">
      <p className="mb-3 flex items-center gap-2 text-sm">{current} <Verified ok={verified} /></p>
      <label className="mb-1.5 block text-xs font-medium text-[var(--color-ink-dim)]">New email</label>
      <input className="fld" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="new@email.com" />
      <button onClick={change} disabled={busy || !email} className="btn-gold mt-4 !w-auto px-4">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Send verification
      </button>
      {msg && <Note kind={msg.k}>{msg.t}</Note>}
    </Card>
  );
}

function PhoneCard({ current, verified }: { current: string; verified: boolean }) {
  const [phone, setPhone] = useState("");
  const [step, setStep] = useState<"idle" | "code">("idle");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);

  async function sendCode() {
    if (!phone) return;
    setBusy(true); setMsg(null);
    const { error } = await authClient.phoneNumber.sendOtp({ phoneNumber: phone });
    setBusy(false);
    if (error) setMsg({ k: "err", t: error.message || "Could not send code." });
    else { setStep("code"); setMsg({ k: "ok", t: `Code sent to ${phone}.` }); }
  }
  async function verify() {
    setBusy(true); setMsg(null);
    const { error } = await authClient.phoneNumber.verify({ phoneNumber: phone, code, updatePhoneNumber: true });
    setBusy(false);
    if (error) setMsg({ k: "err", t: error.message || "Invalid code." });
    else { setStep("idle"); setCode(""); setMsg({ k: "ok", t: "Phone number updated." }); }
  }
  return (
    <Card icon={<Phone className="h-4 w-4 text-[var(--color-gold)]" />} title="Phone number">
      <p className="mb-3 flex items-center gap-2 text-sm">{current || "—"} <Verified ok={verified} /></p>
      {step === "idle" ? (
        <>
          <label className="mb-1.5 block text-xs font-medium text-[var(--color-ink-dim)]">New phone (E.164)</label>
          <input className="fld" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+15145550123" />
          <button onClick={sendCode} disabled={busy || !phone} className="btn-gold mt-4 !w-auto px-4">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Send code
          </button>
        </>
      ) : (
        <>
          <label className="mb-2 block text-xs font-medium text-[var(--color-ink-dim)]">Enter the code sent to {phone}</label>
          <OtpInput value={code} onChange={setCode} />
          <div className="mt-4 flex gap-2">
            <button onClick={verify} disabled={busy || code.length < 6} className="btn-gold !w-auto px-4">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Verify &amp; update
            </button>
            <button onClick={() => { setStep("idle"); setCode(""); }} className="btn-outline !w-auto px-4">Cancel</button>
          </div>
        </>
      )}
      {msg && <Note kind={msg.k}>{msg.t}</Note>}
    </Card>
  );
}

function PasswordCard() {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  async function change() {
    setBusy(true); setMsg(null);
    const { error } = await authClient.changePassword({ currentPassword: cur, newPassword: next, revokeOtherSessions: true });
    setBusy(false);
    if (error) setMsg({ k: "err", t: error.message || "Could not change password." });
    else { setCur(""); setNext(""); setMsg({ k: "ok", t: "Password changed." }); }
  }
  return (
    <Card icon={<Lock className="h-4 w-4 text-[var(--color-gold)]" />} title="Password">
      <div className="space-y-3">
        <input className="fld" type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder="Current password" />
        <input className="fld" type="password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (min 8 chars)" />
      </div>
      <button onClick={change} disabled={busy || !cur || next.length < 8} className="btn-gold mt-4 !w-auto px-4">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Change password
      </button>
      {msg && <Note kind={msg.k}>{msg.t}</Note>}
    </Card>
  );
}
