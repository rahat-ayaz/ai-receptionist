"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export function UserMenu({ name, email }: { name?: string | null; email: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function signOut() {
    setLoading(true);
    await authClient.signOut();
    router.push("/login");
  }

  return (
    <div className="rounded-lg border border-[var(--color-slate-line)] p-3">
      <p className="truncate text-sm font-medium text-[var(--color-ink)]">{name || "Account"}</p>
      <p className="truncate text-xs text-[var(--color-ink-faint)]">{email}</p>
      <button
        onClick={signOut}
        disabled={loading}
        className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-md border border-[var(--color-slate-line)] py-1.5 text-xs text-[var(--color-ink-dim)] transition hover:border-[var(--color-gold)]/50 hover:text-[var(--color-ink)]"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
        Sign out
      </button>
    </div>
  );
}
