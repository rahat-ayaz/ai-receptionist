// ─── Business niche → terminology ───────────────────────────────────────────
// Drives the dynamic catalog tab + page wording. Kept free of React imports so
// it can be used in server components, client components, and API routes alike
// (`iconKey` is mapped to a lucide component at the UI layer).

export type Niche =
  | "RESTAURANT"
  | "MEDICAL"
  | "DENTAL"
  | "LEGAL"
  | "SALON"
  | "AUTOMOTIVE"
  | "REAL_ESTATE"
  | "RETAIL"
  | "OTHER";

export interface NicheConfig {
  niche: Niche;
  /** Dropdown label for the business type. */
  businessLabel: string;
  /** Sidebar tab + page heading noun, e.g. "Menu", "Doctors", "Attorneys". */
  navLabel: string;
  /** lucide icon key (mapped to a component in the UI). */
  iconKey: string;
  /** Singular noun for one entry, e.g. "menu item", "doctor". */
  itemNoun: string;
  itemNounPlural: string;
  /** Whether entries carry a price (restaurants yes, doctors no). */
  hasPrice: boolean;
  /** What the `category` field means for this niche. */
  categoryLabel: string;
  pageTitle: string;
  pageDesc: string;
  namePlaceholder: string;
  categoryPlaceholder: string;
}

export const NICHES: Record<Niche, NicheConfig> = {
  RESTAURANT: {
    niche: "RESTAURANT", businessLabel: "Restaurant / Food", navLabel: "Menu", iconKey: "utensils",
    itemNoun: "menu item", itemNounPlural: "menu items", hasPrice: true, categoryLabel: "Section",
    pageTitle: "Menu", pageDesc: "The priced dishes your receptionist can quote and take orders for.",
    namePlaceholder: "Large Pizza", categoryPlaceholder: "Food",
  },
  MEDICAL: {
    niche: "MEDICAL", businessLabel: "Medical clinic", navLabel: "Doctors", iconKey: "stethoscope",
    itemNoun: "doctor", itemNounPlural: "doctors", hasPrice: false, categoryLabel: "Specialty",
    pageTitle: "Doctors & Providers", pageDesc: "The providers callers can book with, and their specialties.",
    namePlaceholder: "Dr. Jane Smith", categoryPlaceholder: "Cardiology",
  },
  DENTAL: {
    niche: "DENTAL", businessLabel: "Dental clinic", navLabel: "Dentists", iconKey: "stethoscope",
    itemNoun: "dentist", itemNounPlural: "dentists", hasPrice: false, categoryLabel: "Specialty",
    pageTitle: "Dentists", pageDesc: "The dentists and hygienists callers can book with.",
    namePlaceholder: "Dr. Nancy Fahmy", categoryPlaceholder: "General Dentistry",
  },
  LEGAL: {
    niche: "LEGAL", businessLabel: "Law firm", navLabel: "Attorneys", iconKey: "scale",
    itemNoun: "attorney", itemNounPlural: "attorneys", hasPrice: false, categoryLabel: "Practice area",
    pageTitle: "Attorneys", pageDesc: "The attorneys at your firm and their practice areas.",
    namePlaceholder: "Jane Smith", categoryPlaceholder: "Family law",
  },
  SALON: {
    niche: "SALON", businessLabel: "Salon / Spa", navLabel: "Services", iconKey: "scissors",
    itemNoun: "service", itemNounPlural: "services", hasPrice: true, categoryLabel: "Category",
    pageTitle: "Services", pageDesc: "The priced services your receptionist can book.",
    namePlaceholder: "Haircut", categoryPlaceholder: "Hair",
  },
  AUTOMOTIVE: {
    niche: "AUTOMOTIVE", businessLabel: "Automotive / Repair", navLabel: "Services", iconKey: "wrench",
    itemNoun: "service", itemNounPlural: "services", hasPrice: true, categoryLabel: "Category",
    pageTitle: "Services", pageDesc: "The priced services your shop offers.",
    namePlaceholder: "Oil Change", categoryPlaceholder: "Maintenance",
  },
  REAL_ESTATE: {
    niche: "REAL_ESTATE", businessLabel: "Real estate", navLabel: "Listings", iconKey: "home",
    itemNoun: "listing", itemNounPlural: "listings", hasPrice: true, categoryLabel: "Type",
    pageTitle: "Listings", pageDesc: "The properties your receptionist can field enquiries on.",
    namePlaceholder: "123 Main St", categoryPlaceholder: "House",
  },
  RETAIL: {
    niche: "RETAIL", businessLabel: "Retail / Store", navLabel: "Products", iconKey: "shopping-bag",
    itemNoun: "product", itemNounPlural: "products", hasPrice: true, categoryLabel: "Category",
    pageTitle: "Products", pageDesc: "The priced products your receptionist can quote.",
    namePlaceholder: "T-Shirt", categoryPlaceholder: "Apparel",
  },
  OTHER: {
    niche: "OTHER", businessLabel: "Other / General", navLabel: "Catalog", iconKey: "list",
    itemNoun: "item", itemNounPlural: "items", hasPrice: true, categoryLabel: "Category",
    pageTitle: "Catalog", pageDesc: "The items and services your receptionist can quote.",
    namePlaceholder: "Item name", categoryPlaceholder: "General",
  },
};

const NICHE_KEYS = Object.keys(NICHES) as Niche[];

export function isNiche(value: unknown): value is Niche {
  return typeof value === "string" && (NICHE_KEYS as string[]).includes(value);
}

/** Normalize any stored/loose value to a config (unknown → OTHER). */
export function nicheConfig(value: string | null | undefined): NicheConfig {
  return isNiche(value) ? NICHES[value] : NICHES.OTHER;
}

/** Options for the niche selector dropdown. */
export const NICHE_OPTIONS = NICHE_KEYS.map((k) => ({ value: k, label: NICHES[k].businessLabel }));
