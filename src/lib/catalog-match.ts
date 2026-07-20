import { prisma } from "@/lib/prisma";
import type { LineItemInput } from "@/lib/pricing";

// ─── Spoken item → catalog resolution ───────────────────────────────────────
// The voice pipeline hands us item names as the caller said them. Matching them
// against the catalog is inherently lossy, so the important thing is that a
// failure to match is *reported* rather than silently priced at zero.

export interface SpokenItem {
  name: string;
  qty?: number;
}

export interface MatchResult {
  /** Items that resolved to a priced catalog entry. */
  resolved: LineItemInput[];
  /** Items we could not price — kept, but flagged for a human. */
  unmatched: LineItemInput[];
  /** True when anything needs review before the order is trustworthy. */
  needsReview: boolean;
  /** Ready-made note describing what went wrong, or null. */
  reviewNote: string | null;
}

const normalize = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[‘’'"`]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Resolve spoken item names against the tenant's active catalog.
 *
 * Previously this logic lived inline in the voice transcript route and
 * defaulted `unitPrice` to 0 on a miss, so an unrecognized item silently became
 * a free item on a real order. Here, an unmatched item is separated out and
 * described in `reviewNote` so callers can hold the booking instead.
 *
 * Matching is exact-normalized first, then unambiguous substring. A substring
 * hit that matches several catalog entries is treated as unmatched — guessing
 * between "Coke" and "Coke Zero" is worse than admitting we don't know.
 */
export async function resolveLineItems(
  businessProfileId: string,
  items: SpokenItem[],
): Promise<MatchResult> {
  const cleaned = (items ?? []).filter((i) => i?.name?.trim());
  if (cleaned.length === 0) {
    return { resolved: [], unmatched: [], needsReview: false, reviewNote: null };
  }

  const catalog = await prisma.catalogItem.findMany({
    where: { businessProfileId, active: true },
    select: { name: true, price: true },
  });

  const resolved: LineItemInput[] = [];
  const unmatched: LineItemInput[] = [];
  const unpriced: string[] = [];
  const ambiguous: string[] = [];

  for (const item of cleaned) {
    const qty = item.qty && item.qty > 0 ? item.qty : 1;
    const target = normalize(item.name);

    const exact = catalog.filter((c) => normalize(c.name) === target);
    let match = exact[0] ?? null;

    if (!match) {
      const partial = catalog.filter((c) => normalize(c.name).includes(target));
      if (partial.length === 1) {
        match = partial[0];
      } else if (partial.length > 1) {
        ambiguous.push(item.name);
      }
    }

    if (!match) {
      unmatched.push({ name: item.name, qty, unitPrice: 0 });
      continue;
    }

    if (match.price == null) {
      // Legitimately unpriced (a doctor, an attorney) — carry it at zero, but
      // don't treat that as a pricing failure.
      resolved.push({ name: match.name, qty, unitPrice: 0 });
      unpriced.push(match.name);
      continue;
    }

    resolved.push({ name: match.name, qty, unitPrice: match.price });
  }

  const notes: string[] = [];
  if (unmatched.length) {
    notes.push(
      `Not on the menu, priced at $0 — needs review: ${unmatched.map((u) => u.name).join(", ")}.`,
    );
  }
  if (ambiguous.length) {
    notes.push(`Ambiguous item name(s): ${ambiguous.join(", ")}.`);
  }

  return {
    resolved,
    unmatched,
    needsReview: unmatched.length > 0 || ambiguous.length > 0,
    reviewNote: notes.length ? notes.join(" ") : null,
  };
}

/** Everything that should go on the booking, matched or not. */
export function allItems(result: MatchResult): LineItemInput[] {
  return [...result.resolved, ...result.unmatched];
}
