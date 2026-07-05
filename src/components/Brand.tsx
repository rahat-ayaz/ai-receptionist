import { Headset } from "lucide-react";

export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const dims = size === "lg" ? "h-11 w-11" : size === "sm" ? "h-7 w-7" : "h-9 w-9";
  const text = size === "lg" ? "text-2xl" : size === "sm" ? "text-base" : "text-lg";
  return (
    <div className="flex items-center gap-2.5">
      <div
        className={`${dims} grid place-items-center rounded-[10px] bg-[var(--color-gold)] text-[var(--color-midnight)] gold-glow`}
      >
        <Headset className="h-1/2 w-1/2" strokeWidth={2.4} />
      </div>
      <div className={`${text} font-bold tracking-tight leading-none`}>
        CAPRO
        <span className="ml-1 align-middle text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-faint)]">
          TorqAI
        </span>
      </div>
    </div>
  );
}
