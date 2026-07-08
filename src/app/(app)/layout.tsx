import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  LayoutGrid, Phone, BookOpen, MessageSquareText, CreditCard, Settings, CalendarCheck,
  ListChecks, UtensilsCrossed, Stethoscope, Scale, Scissors, Wrench, Home, ShoppingBag,
  AudioLines, FileText, UserCog, Clock, type LucideIcon,
} from "lucide-react";
import { Logo } from "@/components/Brand";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserMenu } from "@/components/auth/UserMenu";
import { nicheConfig } from "@/lib/niche";
import { MobileNav } from "@/components/dashboard/MobileNav";

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

  const pathname = (await headers()).get("x-pathname") || "";

  // Resolve the user's creation date, subscription status, and business niche.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      createdAt: true,
      emailVerified: true,
      phoneNumber: true,
      phoneNumberVerified: true,
      subscription: true,
      businessProfile: {
        select: {
          id: true,
          niche: true,
          twilioNumbers: { where: { active: true }, select: { phoneNumber: true }, take: 1 },
        },
      },
    },
  });

  const profile = user?.businessProfile;
  const hasSubscription = user?.subscription && user.subscription.status !== "CANCELED";
  const trialEndsAt = new Date((user?.createdAt || session.user.createdAt).getTime() + 7 * 24 * 60 * 60 * 1000);
  const isTrialActive = new Date() < trialEndsAt;
  const trialDaysRemaining = Math.max(0, Math.ceil((trialEndsAt.getTime() - new Date().getTime()) / (24 * 60 * 60 * 1000)));

  // Redirect to verify email and phone number if unverified
  if ((!user?.emailVerified || !user?.phoneNumberVerified || !user?.phoneNumber) && pathname !== "/verify") {
    redirect(`/verify?redirect=${encodeURIComponent(pathname)}`);
  }

  // Redirect to billing if trial is expired and they don't have a plan
  if (!isTrialActive && !hasSubscription && pathname !== "/billing") {
    redirect("/billing?trial=expired");
  }

  const cat = nicheConfig(profile?.niche);

  const NAV = profile
    ? [
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
      ]
    : [
        { href: "/onboarding", label: "Setup", icon: Settings },
      ];

  const mobileNavItems = profile
    ? [
        { href: "/dashboard", label: "Overview", iconKey: "LayoutGrid" },
        { href: "/dashboard/calls", label: "Calls", iconKey: "Phone" },
        { href: "/dashboard/bookings", label: "Bookings", iconKey: "CalendarCheck" },
        { href: "/dashboard/catalog", label: cat.navLabel, iconKey: cat.iconKey || "list" },
        { href: "/dashboard/knowledge", label: "Knowledge", iconKey: "BookOpen" },
        { href: "/dashboard/sms-rules", label: "SMS Rules", iconKey: "MessageSquareText" },
        { href: "/dashboard/settings", label: "Agent & Voice", iconKey: "AudioLines" },
        { href: "/dashboard/templates", label: "Templates", iconKey: "FileText" },
        { href: "/billing", label: "Billing", iconKey: "CreditCard" },
        { href: "/dashboard/account", label: "Account", iconKey: "UserCog" },
        { href: "/onboarding", label: "Setup", iconKey: "Settings" },
      ]
    : [
        { href: "/onboarding", label: "Setup", iconKey: "Settings" },
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
        <MobileNav
          userName={session.user.name}
          userEmail={session.user.email}
          receptionistLine={profile?.twilioNumbers?.[0]?.phoneNumber || null}
          navItems={mobileNavItems}
        />
        <main className="min-w-0 flex-1">
          {!hasSubscription && (
            <div className="mx-5 mt-6 sm:mx-8 rounded-lg border border-[var(--color-gold)]/30 bg-[var(--color-gold)]/5 px-4 py-3.5 text-sm text-[var(--color-gold-soft)] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4.5 w-4.5 shrink-0 animate-pulse text-[var(--color-gold)]" />
                <span>
                  You are currently on your <strong>7-day free trial</strong>. You have <strong>{trialDaysRemaining} days</strong> remaining.
                </span>
              </div>
              <Link href="/billing" className="rounded bg-[var(--color-gold)] px-3 py-1 text-xs font-bold text-[var(--color-midnight)] hover:brightness-110 transition">
                Subscribe Now
              </Link>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
