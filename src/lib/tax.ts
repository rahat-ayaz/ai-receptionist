// ─── Canadian sales tax ─────────────────────────────────────────────────────
// Rates by province/territory (current as of 2025). HST provinces fold the
// federal + provincial portions into one rate; the rest charge 5% GST plus a
// provincial sales tax (PST/RST/QST). PST/QST are applied to the selling price
// (additive with GST, not compounded).

interface RateConfig {
  /** Combined HST rate (%) — set for HST provinces, else 0. */
  hst: number;
  /** Federal GST rate (%) — set for non-HST provinces. */
  gst: number;
  /** Provincial PST/RST/QST rate (%). */
  pst: number;
  /** Human label for the provincial component (PST/RST/QST). */
  pstName: string;
}

const RATES: Record<string, RateConfig> = {
  // HST provinces
  ON: { hst: 13, gst: 0, pst: 0, pstName: "PST" },
  NB: { hst: 15, gst: 0, pst: 0, pstName: "PST" },
  NL: { hst: 15, gst: 0, pst: 0, pstName: "PST" },
  NS: { hst: 14, gst: 0, pst: 0, pstName: "PST" }, // reduced to 14% on 2025-04-01
  PE: { hst: 15, gst: 0, pst: 0, pstName: "PST" },
  // GST-only (territories + Alberta)
  AB: { hst: 0, gst: 5, pst: 0, pstName: "PST" },
  NT: { hst: 0, gst: 5, pst: 0, pstName: "PST" },
  NU: { hst: 0, gst: 5, pst: 0, pstName: "PST" },
  YT: { hst: 0, gst: 5, pst: 0, pstName: "PST" },
  // GST + provincial
  BC: { hst: 0, gst: 5, pst: 7, pstName: "PST" },
  MB: { hst: 0, gst: 5, pst: 7, pstName: "RST" },
  SK: { hst: 0, gst: 5, pst: 6, pstName: "PST" },
  QC: { hst: 0, gst: 5, pst: 9.975, pstName: "QST" },
};

// Accept a few common full-name spellings → code.
const ALIASES: Record<string, string> = {
  ONTARIO: "ON",
  QUEBEC: "QC",
  "QUÉBEC": "QC",
  "BRITISH COLUMBIA": "BC",
  ALBERTA: "AB",
  MANITOBA: "MB",
  SASKATCHEWAN: "SK",
  "NEW BRUNSWICK": "NB",
  "NOVA SCOTIA": "NS",
  "NEWFOUNDLAND AND LABRADOR": "NL",
  NEWFOUNDLAND: "NL",
  "PRINCE EDWARD ISLAND": "PE",
  "NORTHWEST TERRITORIES": "NT",
  NUNAVUT: "NU",
  YUKON: "YT",
};

export function normalizeProvince(input: string | null | undefined): string {
  if (!input) return "ON";
  const up = input.trim().toUpperCase();
  if (RATES[up]) return up;
  if (ALIASES[up]) return ALIASES[up];
  return "ON";
}

export interface TaxResult {
  province: string;
  /** Combined effective tax rate (%). */
  rate: number;
  /** Tax amount in CAD (rounded to cents). */
  amount: number;
  /** subtotal + amount. */
  total: number;
  /** Short label, e.g. "HST (13%)" or "GST 5% + PST 7%". */
  label: string;
  /** Component tax amounts in CAD, rounded to cents. */
  breakdown: { gst: number; pst: number; hst: number };
  /**
   * Component tax *rates* (%), unrounded.
   *
   * Consumers that must restate the tax to a third party (a POS, an invoice)
   * need these. Deriving a percentage from `breakdown` instead divides by a
   * cent-rounded amount and drifts — e.g. 13% HST on $46.25 rounds to $6.01,
   * which back-computes to 12.9946%, and Quebec's 9.975% QST becomes 10%.
   */
  rates: { gst: number; pst: number; hst: number };
  /** Label for the provincial component: "PST", "RST" or "QST". */
  pstName: string;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Compute Canadian sales tax on a tax-exclusive subtotal for a province. */
export function computeTax(province: string | null | undefined, subtotal: number): TaxResult {
  const code = normalizeProvince(province);
  const r = RATES[code];

  const rate = r.hst || r.gst + r.pst;
  const amount = round2((subtotal * rate) / 100);

  const label = r.hst
    ? `HST (${r.hst}%)`
    : r.pst
      ? `GST ${r.gst}% + ${r.pstName} ${r.pst}%`
      : `GST (${r.gst}%)`;

  return {
    province: code,
    rate,
    amount,
    total: round2(subtotal + amount),
    label,
    breakdown: {
      gst: round2((subtotal * r.gst) / 100),
      pst: round2((subtotal * r.pst) / 100),
      hst: round2((subtotal * r.hst) / 100),
    },
    rates: { gst: r.gst, pst: r.pst, hst: r.hst },
    pstName: r.pstName,
  };
}

/** Province codes for UI dropdowns. */
export const PROVINCES = Object.keys(RATES);
