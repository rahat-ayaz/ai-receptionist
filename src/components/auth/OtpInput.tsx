"use client";

import { useRef } from "react";

/** A 6-box one-time-code input. Value is the joined string of digits. */
export function OtpInput({
  value,
  onChange,
  length = 6,
}: {
  value: string;
  onChange: (v: string) => void;
  length?: number;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(length).slice(0, length).split("");

  function setAt(i: number, d: string) {
    const next = digits.map((c, idx) => (idx === i ? d : c)).join("").trimEnd();
    onChange(next);
    if (d && i < length - 1) refs.current[i + 1]?.focus();
  }

  return (
    <div className="flex justify-between gap-2">
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          maxLength={1}
          value={digits[i]?.trim() || ""}
          onChange={(e) => setAt(i, e.target.value.replace(/\D/g, "").slice(-1))}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !digits[i]?.trim() && i > 0) refs.current[i - 1]?.focus();
          }}
          onPaste={(e) => {
            e.preventDefault();
            const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
            if (pasted) {
              onChange(pasted);
              refs.current[Math.min(pasted.length, length - 1)]?.focus();
            }
          }}
          className="h-12 w-full rounded-lg border border-[var(--color-slate-line)] bg-[rgba(12,21,42,0.6)] text-center text-lg font-semibold text-[var(--color-ink)] outline-none focus:border-[var(--color-gold)]"
        />
      ))}
    </div>
  );
}
