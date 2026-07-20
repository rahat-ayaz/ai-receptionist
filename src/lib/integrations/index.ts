import { prisma } from "@/lib/prisma";
import { openSecrets, sealSecrets, DecryptFailedError } from "@/lib/crypto";
import { genericRestAdapter } from "./adapters/generic-rest";
import { getSquareContext, squareAdapter } from "./adapters/square";
import {
  fail,
  type AdapterResult,
  type Capability,
  type IntegrationAdapter,
  type IntegrationContext,
} from "./types";
import type { Integration } from "@prisma/client";

// ─── Adapter resolution + capability guard ──────────────────────────────────

const ADAPTERS: Record<string, IntegrationAdapter> = {
  generic_rest: genericRestAdapter,
  square: squareAdapter,
};

export function getAdapter(provider: string): IntegrationAdapter | null {
  return ADAPTERS[provider] ?? null;
}

/**
 * Run an adapter method behind its declared capability. Optional methods are
 * never called blind — a provider that doesn't declare the capability returns a
 * non-retryable UNSUPPORTED rather than throwing "fn is not a function".
 */
export async function invoke<T>(
  adapter: IntegrationAdapter,
  cap: Capability,
  fn: (a: IntegrationAdapter) => Promise<AdapterResult<T>> | undefined,
): Promise<AdapterResult<T>> {
  if (!adapter.capabilities.has(cap)) {
    return fail("UNSUPPORTED", `${adapter.provider} does not support ${cap}.`);
  }
  const result = fn(adapter);
  if (!result) {
    return fail("UNSUPPORTED", `${adapter.provider} declares ${cap} but does not implement it.`);
  }
  return result;
}

/**
 * Decrypt credentials and build the adapter context. Returns null (after
 * flipping the integration to NEEDS_REAUTH) when the secrets can't be opened —
 * a lost or rotated-away key must degrade to "reconnect", never to a crash.
 */
export async function buildContext(integration: Integration): Promise<IntegrationContext | null> {
  let secrets: Record<string, string> = {};

  // Form providers may legitimately have no secrets at all (authType "none").
  if (integration.secretsCipher) {
    try {
      secrets = openSecrets(integration, integration.businessProfileId, integration.provider);
    } catch (err) {
      if (err instanceof DecryptFailedError) {
        await prisma.integration.update({
          where: { id: integration.id },
          data: {
            status: "NEEDS_REAUTH",
            lastErrorAt: new Date(),
            lastErrorCode: "DECRYPT_FAILED",
            lastErrorMessage: err.message,
          },
        });
        return null;
      }
      throw err; // CryptoNotConfiguredError — a deployment problem, surface it.
    }
  }

  const ctx: IntegrationContext = {
    integrationId: integration.id,
    businessProfileId: integration.businessProfileId,
    provider: integration.provider,
    config: (integration.config as Record<string, unknown>) ?? {},
    secrets,
    async persistSecrets(next, expiresAt) {
      const sealed = sealSecrets(next, integration.businessProfileId, integration.provider);
      await prisma.integration.update({
        where: { id: integration.id },
        data: {
          ...sealed,
          ...(expiresAt !== undefined ? { accessTokenExpiresAt: expiresAt } : {}),
        },
      });
    },
  };

  // Square access tokens expire in ~30 days and there is no worker to renew
  // them, so refresh lazily whenever a context is built.
  if (integration.provider === "square") {
    return getSquareContext(integration, ctx);
  }

  return ctx;
}

/** Record a provider failure on the integration so the UI can surface it. */
export async function recordError(
  integrationId: string,
  code: string,
  message: string,
): Promise<void> {
  await prisma.integration.update({
    where: { id: integrationId },
    data: {
      lastErrorAt: new Date(),
      lastErrorCode: code,
      lastErrorMessage: message.slice(0, 2000),
      // An auth failure is terminal until the owner reconnects.
      ...(code === "AUTH" ? { status: "NEEDS_REAUTH" as const } : {}),
    },
  });
}

export async function clearError(integrationId: string): Promise<void> {
  await prisma.integration.update({
    where: { id: integrationId },
    data: { lastErrorAt: null, lastErrorCode: null, lastErrorMessage: null },
  });
}
