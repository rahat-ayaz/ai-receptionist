import Papa from "papaparse";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { Type } from "@google/genai";
import { gemini, GEMINI_MODEL } from "@/lib/gemini";
import { nicheConfig, isNiche, type Niche } from "@/lib/niche";

export interface ExtractedItem {
  name: string;
  price?: number | null;
  category?: string | null;
  description?: string | null;
}

export interface ExtractionResult {
  suggestedNiche: Niche | null;
  items: ExtractedItem[];
  usedAi: boolean;
}

// ─── Document → text ────────────────────────────────────────────────────────

function ext(filename: string): string {
  return filename.toLowerCase().split(".").pop() ?? "";
}

/** Parse an uploaded document buffer into plain text, dispatching by type. */
export async function parseDocument(buffer: Buffer, filename: string): Promise<string> {
  const e = ext(filename);

  if (e === "pdf") {
    // pdf-parse is an external server package (not bundled), so its debug-on-
    // import code stays dormant (module.parent is set when required normally).
    const pdfParse = (await import("pdf-parse")).default;
    const data = await pdfParse(buffer);
    return data.text;
  }
  if (e === "docx") {
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }
  if (e === "xlsx" || e === "xls") {
    const wb = XLSX.read(buffer, { type: "buffer" });
    return wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n])).join("\n");
  }
  // csv, tsv, txt, md, and anything else → utf-8 text.
  return buffer.toString("utf8");
}

// ─── Text → structured entries ──────────────────────────────────────────────

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function toPrice(v: unknown): number | null {
  if (typeof v === "number" && isFinite(v)) return round2(v);
  if (typeof v === "string") {
    const m = v.replace(/[^0-9.,]/g, "").replace(",", ".");
    const n = parseFloat(m);
    return isFinite(n) ? round2(n) : null;
  }
  return null;
}

function findKey(keys: string[], re: RegExp): string | undefined {
  return keys.find((k) => re.test(k));
}

/** Try to read tabular (CSV/XLSX-derived) text with a recognizable header. */
function tryTabular(text: string): ExtractedItem[] {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const rows = parsed.data;
  if (!rows.length || !parsed.meta.fields?.length) return [];

  const keys = parsed.meta.fields.map((f) => f.toLowerCase());
  const nameKey = findKey(keys, /name|item|dish|service|product|title|provider|doctor|attorney|listing/);
  if (!nameKey) return [];
  const priceKey = findKey(keys, /price|cost|rate|amount|fee/);
  const catKey = findKey(keys, /category|section|specialty|speciality|type|area|department/);
  const descKey = findKey(keys, /desc|detail|notes?/);

  const fieldFor = (row: Record<string, string>, lowerKey: string) => {
    const orig = parsed.meta.fields!.find((f) => f.toLowerCase() === lowerKey);
    return orig ? row[orig] : undefined;
  };

  return rows
    .map((row) => ({
      name: (fieldFor(row, nameKey) ?? "").trim(),
      price: priceKey ? toPrice(fieldFor(row, priceKey)) : null,
      category: catKey ? (fieldFor(row, catKey) ?? "").trim() || null : null,
      description: descKey ? (fieldFor(row, descKey) ?? "").trim() || null : null,
    }))
    .filter((i) => i.name);
}

/** Line-based heuristic: "Name …… $12.99" or, for unpriced niches, name lines. */
function lineHeuristic(text: string, hasPrice: boolean): ExtractedItem[] {
  const priceRe = /(?:\$|cad|usd)?\s*(\d{1,5}(?:[.,]\d{2})?)\s*$/i;
  const lines = text
    .split(/\r?\n|•|•/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 2 && l.length <= 140);

  const items: ExtractedItem[] = [];
  for (const line of lines) {
    const m = line.match(priceRe);
    if (m && /[a-z]/i.test(line.slice(0, m.index))) {
      const name = line.slice(0, m.index).replace(/[.\-–:\s]+$/, "").trim();
      if (name) items.push({ name, price: toPrice(m[1]) });
    } else if (!hasPrice) {
      // Unpriced niche (doctors/attorneys): keep "Dr. X — Specialty"-style lines.
      if (/^(dr\.?|doctor|atty\.?|attorney|mr\.?|ms\.?|mrs\.?|prof\.?)/i.test(line) || /[—\-–:|]/.test(line)) {
        const [namePart, catPart] = line.split(/[—\-–:|]/);
        const name = namePart.trim();
        if (name.length >= 2) items.push({ name, category: catPart?.trim() || null });
      }
    }
  }
  return items;
}

function dedupe(items: ExtractedItem[]): ExtractedItem[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = i.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const NICHE_ENUM: Niche[] = ["RESTAURANT", "MEDICAL", "DENTAL", "LEGAL", "SALON", "AUTOMOTIVE", "REAL_ESTATE", "RETAIL", "OTHER"];

/** AI extraction (used when GEMINI_API_KEY is set). */
async function aiExtract(text: string, niche: string | null): Promise<ExtractionResult> {
  const cfg = nicheConfig(niche);
  const res = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              `Extract a clean list of ${cfg.itemNounPlural} from the following business content. ` +
              `For each, give a name, an optional price as a plain number (no currency symbol), an optional ` +
              `${cfg.categoryLabel.toLowerCase()} (the "category" field), and an optional short description. ` +
              `Also classify the overall business niche. Only return real entries, no headings.\n\nCONTENT:\n${text.slice(0, 30000)}`,
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          niche: { type: Type.STRING, enum: NICHE_ENUM },
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                price: { type: Type.NUMBER },
                category: { type: Type.STRING },
                description: { type: Type.STRING },
              },
              required: ["name"],
            },
          },
        },
        required: ["items"],
      },
      temperature: 0.2,
    },
  });

  const parsed = JSON.parse(res.text ?? "{}") as { niche?: string; items?: ExtractedItem[] };
  const items = dedupe(
    (parsed.items ?? [])
      .filter((i) => i.name?.trim())
      .map((i) => ({
        name: i.name.trim(),
        price: toPrice(i.price),
        category: i.category?.trim() || null,
        description: i.description?.trim() || null,
      })),
  ).slice(0, 300);

  return { suggestedNiche: isNiche(parsed.niche) ? parsed.niche : null, items, usedAi: true };
}

/**
 * Extract structured entries from raw text. Uses Gemini when a key is set,
 * otherwise a tabular + line-based heuristic (clearly best-effort).
 */
export async function extractEntries(text: string, niche: string | null): Promise<ExtractionResult> {
  if (!text.trim()) return { suggestedNiche: null, items: [], usedAi: false };

  if (process.env.GEMINI_API_KEY) {
    try {
      return await aiExtract(text, niche);
    } catch (err) {
      console.error("[ingest] AI extraction failed, falling back to heuristic:", err);
    }
  }

  const cfg = nicheConfig(niche);
  const tabular = tryTabular(text);
  const items = dedupe(tabular.length ? tabular : lineHeuristic(text, cfg.hasPrice)).slice(0, 300);
  return { suggestedNiche: null, items, usedAi: false };
}
