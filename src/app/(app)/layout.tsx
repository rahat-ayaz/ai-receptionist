import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  LayoutGrid, Phone, BookOpen, MessageSquareText, CreditCard, Settings, CalendarCheck,
  ListChecks, UtensilsCrossed, Stethoscope, Scale, Scissors, Wrench, Home, ShoppingBag,
  AudioLines, FileText, UserCog, type LucideIcon,
} from "lucide-react";
import { Logo } from "@/components/Brand";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserMenu } from "@/components/auth/UserMenu";
import { nicheConfig } from "@/lib/niche";

// Map a niche config iconKey → lucide component for the dynamic catalog tab.
const NICHE_ICONS: Record<string, LucideIcon> = {
  utensils: UtensilsCrossed,
  stethoscope: Stethoscope,
  scale: Scale,
  scissors: Scissors,
  wrench: Wrench,
  home: Home,
  "shopping-bag": ShoppingBag,
  list: ListChecks,
};

// Shared app shell — sidebar + auth gate for the dashboard, billing, and setup pages.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  // Resolve the dynamic catalog tab label/icon from the business niche.
  const profile = await prisma.businessProfile.findUnique({
    where: { userId: session.user.id },
    select: {
      niche: true,
      twilioNumbers: { where: { active: true }, select: { phoneNumber: true }, take: 1 },
    },
  });
  const cat = nicheConfig(profile?.niche);

  const NAV = [
    { href: "/dashboard", label: "Overview", icon: LayoutGrid },
    { href: "/dashboard/calls", label: "Calls", icon: Phone },
    { href: "/dashboard/bookings", label: "Bookings", icon: CalendarCheck },
    { href: "/dashboard/catalog", label: cat.navLabel, icon: NICHE_ICONS[cat.iconKey] ?? ListChecks },
    { href: "/dashboard/knowledge", label: "Knowledge", icon: BookOpen },
    { href: "/dashboard/sms-rules", label: "SMS Rules", icon: MessageSquareText },
    { href: "/dashboard/settings", label: "Agent & Voice", icon: AudioLines },
    { href: "/dashboard/templates", label: "Templates", icon: FileText },
    { href: "/billing", label: "Billing", icon: CreditCard },
    { href: "/dashboard/account", label: "Account", icon: UserCog },
    { href: "/onboarding", label: "Setup", icon: Settings },
  ];

  return (
    <div className="flex min-h-screen">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-[var(--color-slate-line)] bg-[var(--color-midnight)]/70 px-4 py-5 lg:flex">
        <div className="px-2">
          <Link href="/dashboard">
            <Logo />
          </Link>
        </div>
        <nav className="mt-8 space-y-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[var(--color-ink-dim)] transition hover:bg-[var(--color-navy-700)] hover:text-[var(--color-ink)]"
            >
              <item.icon className="h-4.5 w-4.5" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto">
          {profile?.twilioNumbers?.[0] && (
            <div className="mb-4 rounded-lg bg-[var(--color-navy-700)]/40 p-3 border border-[var(--color-slate-line)]/50">
              <span className="block text-[10px] uppercase tracking-wider font-semibold text-[var(--color-ink-faint)]">Receptionist Line</span>
              <span className="text-sm font-mono font-bold text-[var(--color-gold-soft)]">{profile.twilioNumbers[0].phoneNumber}</span>
            </div>
          )}
          <UserMenu name={session.user.name} email={session.user.email} />
          <p className="mt-2 px-1 text-[10px] text-[var(--color-ink-faint)]">CAPRO v1.0 · TorqAI</p>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-[var(--color-slate-line)] px-5 py-3 lg:hidden">
          <Link href="/dashboard">
            <Logo size="sm" />
          </Link>
          <nav className="flex gap-3 text-sm text-[var(--color-ink-dim)]">
            <Link href="/dashboard/calls">Calls</Link>
            <Link href="/billing">Billing</Link>
          </nav>
        </header>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
