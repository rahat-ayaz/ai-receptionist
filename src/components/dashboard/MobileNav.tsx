"use client";

import { useState } from "react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import {
  Menu, X, LayoutGrid, Phone, CalendarCheck, BookOpen,
  MessageSquareText, CreditCard, Settings, AudioLines, FileText, UserCog, LogOut,
  UtensilsCrossed, Stethoscope, Scale, Scissors, Wrench, Home, ShoppingBag, ListChecks, Plug
} from "lucide-react";
import { Logo } from "@/components/Brand";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

interface MobileNavProps {
  userName: string;
  userEmail: string;
  receptionistLine?: string | null;
  navItems: { href: string; label: string; iconKey: string }[];
}

const ICON_MAP: Record<string, any> = {
  LayoutGrid,
  Phone,
  CalendarCheck,
  BookOpen,
  MessageSquareText,
  CreditCard,
  Settings,
  AudioLines,
  FileText,
  UserCog,
  Plug,
  utensils: UtensilsCrossed,
  stethoscope: Stethoscope,
  scale: Scale,
  scissors: Scissors,
  wrench: Wrench,
  home: Home,
  "shopping-bag": ShoppingBag,
  list: ListChecks,
};

export function MobileNav({ userName, userEmail, receptionistLine, navItems }: MobileNavProps) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      {/* Mobile top bar */}
      <header className="flex items-center justify-between border-b border-[var(--color-slate-line)] bg-[var(--color-midnight)]/90 backdrop-blur-md px-5 py-3 lg:hidden sticky top-0 z-40">
        <NextLink href="/dashboard" onClick={() => setIsOpen(false)}>
          <Logo size="sm" />
        </NextLink>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="rounded-lg p-1.5 text-[var(--color-ink-dim)] hover:bg-[var(--color-navy-700)] hover:text-[var(--color-ink)] transition"
          aria-label="Toggle menu"
        >
          {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </header>

      {/* Drawer Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Drawer Panel */}
      <div
        className={`fixed inset-y-0 right-0 w-72 bg-[var(--color-midnight)] border-l border-[var(--color-slate-line)] z-50 transform transition-transform duration-300 lg:hidden flex flex-col ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Drawer Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-slate-line)]/60">
          <span className="font-semibold text-sm text-[var(--color-ink-dim)]">Menu</span>
          <button
            onClick={() => setIsOpen(false)}
            className="rounded-lg p-1 text-[var(--color-ink-dim)] hover:bg-[var(--color-navy-700)] transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
          {navItems.map((item) => {
            const Icon = ICON_MAP[item.iconKey] || Settings;
            const isActive = pathname === item.href;
            return (
              <NextLink
                key={item.href}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                  isActive
                    ? "bg-[var(--color-gold)]/10 text-[var(--color-gold-soft)] border border-[var(--color-gold)]/20"
                    : "text-[var(--color-ink-dim)] hover:bg-[var(--color-navy-700)]/60 hover:text-[var(--color-ink)]"
                }`}
              >
                <Icon className="h-4.5 w-4.5" />
                {item.label}
              </NextLink>
            );
          })}
        </nav>

        {/* Footer & User Info */}
        <div className="p-4 border-t border-[var(--color-slate-line)] bg-[var(--color-navy-800)]/40 space-y-4">
          {receptionistLine && (
            <div className="rounded-lg bg-[var(--color-navy-700)]/60 p-3 border border-[var(--color-slate-line)]/50">
              <span className="block text-[9px] uppercase tracking-wider font-semibold text-[var(--color-ink-faint)]">Receptionist Line</span>
              <span className="text-xs font-mono font-bold text-[var(--color-gold-soft)]">{receptionistLine}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-[var(--color-ink)] truncate">{userName}</p>
              <p className="text-[10px] text-[var(--color-ink-faint)] truncate">{userEmail}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="rounded-lg p-2 text-red-400 hover:bg-red-500/10 transition"
              title="Sign Out"
            >
              <LogOut className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
