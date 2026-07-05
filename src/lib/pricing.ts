import { computeTax, type TaxResult } from "@/lib/tax";

// ─── Order pricing ──────────────────────────────────────────────────────────

export interface LineItemInput {
  name: string;
  qty: number;
  unitPrice: number;
}

export interface LineItem extends LineItemInput {
  lineTotal: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n: number) => `$${n.toFixed(2)}`;

/** Normalize raw line items and compute each line total + the subtotal. */
export function priceLineItems(items: LineItemInput[]): { lineItems: LineItem[]; subtotal: number } {
  const lineItems = items
    .filter((i) => i.name && i.qty > 0)
    .map((i) => ({
      name: i.name,
      qty: i.qty,
      unitPrice: round2(i.unitPrice),
      lineTotal: round2(i.qty * i.unitPrice),
    }));
  const subtotal = round2(lineItems.reduce((sum, i) => sum + i.lineTotal, 0));
  return { lineItems, subtotal };
}

export interface PricedOrder {
  lineItems: LineItem[];
  subtotal: number;
  tax: TaxResult;
  total: number;
}

/** Full price an order: line items → subtotal → tax → total. */
export function priceOrder(items: LineItemInput[], province: string): PricedOrder {
  const { lineItems, subtotal } = priceLineItems(items);
  const tax = computeTax(province, subtotal);
  return { lineItems, subtotal, tax, total: tax.total };
}

/**
 * A spoken-style confirmation the agent can read back ("repeat the order"),
 * also shown in the dashboard. e.g.:
 *   "That's 2 × Large Pizza at $15.00 and 1 × Garlic Bread at $6.00 —
 *    subtotal $36.00, HST (13%) $4.68, total $40.68. Shall I confirm?"
 */
export function summarizeOrder(order: PricedOrder): string {
  if (order.lineItems.length === 0) return "There are no items on this order yet.";

  const parts = order.lineItems.map((i) => `${i.qty} × ${i.name} at ${money(i.unitPrice)}`);
  const itemsPhrase =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

  return (
    `That's ${itemsPhrase} — subtotal ${money(order.subtotal)}, ` +
    `${order.tax.label} ${money(order.tax.amount)}, total ${money(order.total)}. ` +
    `Shall I confirm?`
  );
}
