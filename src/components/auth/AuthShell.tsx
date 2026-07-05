import Link from "next/link";
import { Logo } from "@/components/Brand";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-5 py-8">
      <header>
        <Link href="/" className="inline-block">
          <Logo />
        </Link>
      </header>

      <div className="flex flex-1 flex-col justify-center py-10">
        <div className="tile p-7">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-[var(--color-ink-dim)]">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-5 text-center text-sm text-[var(--color-ink-dim)]">{footer}</div>}
      </div>
    </main>
  );
}
