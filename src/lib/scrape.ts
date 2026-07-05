// ─── URL → readable text ────────────────────────────────────────────────────
// Shared by onboarding ingestion and the catalog import endpoint.

export const URL_RE = /^https?:\/\/\S+$/i;

/** Strip a fetched HTML page down to readable text (no extra dependency). */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40000);
}

/** Fetch a URL and return its readable text. Throws on network failure. */
export async function fetchUrlText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "CAPRO-Ingestion/1.0" } });
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  return htmlToText(await res.text());
}
