import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// ─── Credential encryption ──────────────────────────────────────────────────
// Third-party credentials (POS/CRM OAuth tokens, API keys) are the first
// secrets this app stores per tenant rather than per deployment, so they get
// envelope encryption at rest: AES-256-GCM, random IV per write, and an AAD
// bound to the owning row so a stolen ciphertext can't be replayed onto a
// different tenant's integration.
//
// Keyring env vars:
//   CREDENTIAL_ENC_KEYS   "v1:<base64-32-bytes>,v2:<base64-32-bytes>"
//   CREDENTIAL_ENC_ACTIVE "v2"   — the version used for all new writes
//
// Rotation: add a key, flip ACTIVE, deploy. Existing rows still decrypt under
// their recorded version, and every token refresh re-wraps under the new one.

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

export interface SealedSecrets {
  secretsCipher: string;
  secretsIv: string;
  secretsTag: string;
  secretsKeyVer: string;
}

export class CryptoNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoNotConfiguredError";
  }
}

export class DecryptFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecryptFailedError";
  }
}

interface Keyring {
  keys: Map<string, Buffer>;
  active: string;
}

let cached: Keyring | null = null;

/**
 * Parse the keyring lazily, mirroring how `getStripe()` defers its env read.
 * The app must boot without these vars — only integration code paths need them,
 * and they surface a 503 rather than taking the whole deployment down.
 */
function getKeyring(): Keyring {
  if (cached) return cached;

  const raw = process.env.CREDENTIAL_ENC_KEYS;
  const active = process.env.CREDENTIAL_ENC_ACTIVE;
  if (!raw || !active) {
    throw new CryptoNotConfiguredError(
      "CREDENTIAL_ENC_KEYS and CREDENTIAL_ENC_ACTIVE must be set to use integrations.",
    );
  }

  const keys = new Map<string, Buffer>();
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(":");
    if (sep < 1) {
      throw new CryptoNotConfiguredError(`Malformed CREDENTIAL_ENC_KEYS entry: "${trimmed}"`);
    }
    const version = trimmed.slice(0, sep);
    const key = Buffer.from(trimmed.slice(sep + 1), "base64");
    if (key.length !== 32) {
      throw new CryptoNotConfiguredError(
        `Key "${version}" must be 32 bytes base64-encoded (got ${key.length}).`,
      );
    }
    keys.set(version, key);
  }

  if (!keys.has(active)) {
    throw new CryptoNotConfiguredError(
      `CREDENTIAL_ENC_ACTIVE="${active}" has no matching key in CREDENTIAL_ENC_KEYS.`,
    );
  }

  cached = { keys, active };
  return cached;
}

/** True when the keyring is usable — lets routes return a clean 503. */
export function isCryptoConfigured(): boolean {
  try {
    getKeyring();
    return true;
  } catch {
    return false;
  }
}

/** The version new writes will use. Exported for the rekey sweep. */
export function activeKeyVersion(): string {
  return getKeyring().active;
}

/**
 * Bind ciphertext to the row that owns it. Both values are known before the
 * row exists, so this works on insert as well as update.
 */
function aad(businessProfileId: string, provider: string): Buffer {
  return Buffer.from(`${businessProfileId}:${provider}`, "utf8");
}

/** Encrypt a secret bundle under the active key. */
export function sealSecrets(
  secrets: Record<string, string>,
  businessProfileId: string,
  provider: string,
): SealedSecrets {
  const { keys, active } = getKeyring();
  const key = keys.get(active)!;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  cipher.setAAD(aad(businessProfileId, provider));

  const plaintext = Buffer.from(JSON.stringify(secrets), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    secretsCipher: ciphertext.toString("base64"),
    secretsIv: iv.toString("base64"),
    secretsTag: cipher.getAuthTag().toString("base64"),
    secretsKeyVer: active,
  };
}

/**
 * Decrypt a secret bundle. Throws DecryptFailedError when the key is gone or
 * the ciphertext has been tampered with — callers flip the integration to
 * NEEDS_REAUTH rather than crashing, so the owner just reconnects.
 */
export function openSecrets(
  sealed: Partial<Record<keyof SealedSecrets, string | null>> | null | undefined,
  businessProfileId: string,
  provider: string,
): Record<string, string> {
  if (!sealed?.secretsCipher || !sealed.secretsIv || !sealed.secretsTag || !sealed.secretsKeyVer) {
    throw new DecryptFailedError("Integration has no stored credentials.");
  }

  const { keys } = getKeyring();
  const key = keys.get(sealed.secretsKeyVer);
  if (!key) {
    throw new DecryptFailedError(
      `Encryption key "${sealed.secretsKeyVer}" is not in the current keyring.`,
    );
  }

  try {
    const decipher = createDecipheriv(ALGO, key, Buffer.from(sealed.secretsIv, "base64"));
    decipher.setAAD(aad(businessProfileId, provider));
    decipher.setAuthTag(Buffer.from(sealed.secretsTag, "base64"));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(sealed.secretsCipher, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as Record<string, string>;
  } catch (err) {
    // GCM auth failure, wrong key, or corrupt JSON all land here. Never leak
    // the underlying detail to a caller that might surface it to a client.
    throw new DecryptFailedError(
      `Could not decrypt integration credentials: ${(err as Error).name}`,
    );
  }
}

/** Test-only: drop the memoized keyring so env changes take effect. */
export function __resetKeyringForTests(): void {
  cached = null;
}
