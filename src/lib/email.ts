// ─── Email delivery ─────────────────────────────────────────────────────────
// Uses Resend when RESEND_API_KEY is set; otherwise logs the message to the
// server console so verification/reset codes are visible during local dev.

interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  /** Optional branded HTML body (falls back to `text` for plain clients). */
  html?: string;
}

const FROM = process.env.EMAIL_FROM || "CAPRO <no-reply@torqai.ca>";

export async function sendEmail({ to, subject, text, html }: SendEmailOptions): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    // Dev fallback — make the contents (e.g. an OTP code) easy to spot.
    console.log(
      `\n📧 [email:console] To: ${to}\n   Subject: ${subject}\n   ${text}${html ? "\n   [branded HTML attached]" : ""}\n`,
    );
    return;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to, subject, text, ...(html ? { html } : {}) }),
    });
    if (!res.ok) {
      console.error("[email] Resend error:", res.status, await res.text());
    }
  } catch (err) {
    console.error("[email] send failed:", err);
  }
}
