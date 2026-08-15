/**
 * Public base URL of this deployment, without a trailing slash.
 *
 * Used for Twilio callback URLs and for links pasted into customer email and
 * SMS, so a wrong value here fails silently and remotely: Twilio just gets a
 * host that doesn't answer.
 *
 * Never hardcode a domain as the fallback — one that isn't attached yet is
 * worse than no answer at all. Vercel injects the project's stable production
 * hostname, which is correct by construction and follows the project when a
 * custom domain is added later.
 */
export function appBaseUrl(): string {
  const configured = process.env.BETTER_AUTH_URL || process.env.APP_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");

  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelHost) {
    console.warn(
      "[app-url] Neither BETTER_AUTH_URL nor APP_BASE_URL is set — falling back to " +
        `the Vercel production host (${vercelHost}). Set them explicitly.`,
    );
    return `https://${vercelHost}`;
  }

  console.warn("[app-url] No public base URL configured — assuming local development.");
  return "http://localhost:3000";
}
