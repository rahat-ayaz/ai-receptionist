// ─── Branded email rendering + template tokens ──────────────────────────────

export interface Brand {
  brandColor: string | null;
  brandAccentColor: string | null;
  logoData: string | null;
}

/** Replace {{token}} placeholders with values (unknown tokens are left blank). */
export function applyTokens(input: string, vars: Record<string, string>): string {
  return input.replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Wrap message content in a simple, email-client-safe branded HTML shell using
 * the tenant's logo + colours. `body` may contain plain text (newlines become
 * paragraphs) — it's escaped, so pass trusted plain content.
 */
export function renderBrandedEmail(opts: {
  brand: Brand;
  businessName: string;
  heading: string;
  body: string;
  items?: { name: string; qty: number; unitPrice: number; lineTotal: number }[];
  subtotal?: number;
  taxAmount?: number;
  taxLabel?: string;
  total?: number;
}): string {
  const primary = opts.brand.brandColor || "#b96be7";
  const accent = opts.brand.brandAccentColor || primary;
  const logo = opts.brand.logoData;

  const cleanBody = opts.body.replace(/\\n/g, "\n");

  const paragraphs = cleanBody
    .split(/\n{2,}|\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      if (opts.items && opts.items.length > 0) {
        // Skip text-based items/total lines if we are rendering a nice HTML table
        if (/^(items\s*:|total\s*:)/i.test(line)) return false;
      }
      return true;
    })
    .map((line) => `<p style="margin:0 0 12px;line-height:1.5;color:#1f2430;">${esc(line)}</p>`)
    .join("");

  let tableHtml = "";
  if (opts.items && opts.items.length > 0) {
    tableHtml = `
    <table cellpadding="0" cellspacing="0" style="width:100%; border-collapse:collapse; margin-top:20px; font-size:14px; border-top:1px solid #e6e6ee;">
      <thead>
        <tr style="border-bottom:1px solid #e6e6ee; text-align:left;">
          <th style="padding:10px 0; font-weight:600; color:#1f2430;">Item</th>
          <th style="padding:10px 0; font-weight:600; color:#1f2430; text-align:center;">Qty</th>
          <th style="padding:10px 0; font-weight:600; color:#1f2430; text-align:right;">Price</th>
        </tr>
      </thead>
      <tbody>
        ${opts.items.map((i) => `
          <tr style="border-bottom:1px solid #fafafc;">
            <td style="padding:10px 0; color:#1f2430;">${esc(i.name)}</td>
            <td style="padding:10px 0; text-align:center; color:#1f2430;">${i.qty}</td>
            <td style="padding:10px 0; text-align:right; color:#1f2430;">$${i.lineTotal.toFixed(2)}</td>
          </tr>
        `).join("")}
        <tr>
          <td colspan="2" style="padding:10px 0 2px; text-align:right; color:#8a8f9c;">Subtotal:</td>
          <td style="padding:10px 0 2px; text-align:right; color:#1f2430;">$${(opts.subtotal ?? 0).toFixed(2)}</td>
        </tr>
        ${opts.taxAmount !== undefined && opts.taxAmount > 0 ? `
        <tr>
          <td colspan="2" style="padding:2px 0; text-align:right; color:#8a8f9c;">${esc(opts.taxLabel || "Tax")}:</td>
          <td style="padding:2px 0; text-align:right; color:#1f2430;">$${opts.taxAmount.toFixed(2)}</td>
        </tr>
        ` : ""}
        <tr style="border-top:1px solid #e6e6ee;">
          <td colspan="2" style="padding:10px 0; text-align:right; font-weight:bold; color:#111318;">Total:</td>
          <td style="padding:10px 0; text-align:right; font-weight:bold; color:#111318;">$${(opts.total ?? 0).toFixed(2)}</td>
        </tr>
      </tbody>
    </table>`;
  }

  const header = logo
    ? `<img src="${logo}" alt="${esc(opts.businessName)}" style="max-height:44px;max-width:180px;" />`
    : `<span style="font-size:20px;font-weight:700;color:#ffffff;">${esc(opts.businessName)}</span>`;

  return `<!doctype html><html><body style="margin:0;background:#f4f4f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e6ee;">
        <tr><td style="background:${primary};padding:20px 28px;">${header}</td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 16px;font-size:20px;color:#111318;">${esc(opts.heading)}</h1>
          ${paragraphs}
          ${tableHtml}
        </td></tr>
        <tr><td style="height:4px;background:${accent};"></td></tr>
        <tr><td style="padding:16px 28px;background:#fafafc;font-size:12px;color:#8a8f9c;">
          Sent by ${esc(opts.businessName)} · Powered by <a href="https://torqai.ca" style="color:${primary};text-decoration:none;">TorqAI Technologies Inc.</a>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}
