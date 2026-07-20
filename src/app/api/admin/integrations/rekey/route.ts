import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isComplimentaryUser } from "@/lib/billing";
import { activeKeyVersion, isCryptoConfigured, openSecrets, sealSecrets } from "@/lib/crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Credential key rotation, matching the owner-only gate on
 * /api/admin/accounts (TEST_ACCOUNT_EMAILS allowlist).
 *
 * Rotation procedure:
 *   1. Add a new key to CREDENTIAL_ENC_KEYS  ("v1:…,v2:…")
 *   2. Point CREDENTIAL_ENC_ACTIVE at it     ("v2")
 *   3. Deploy — old rows still decrypt under their recorded version
 *   4. POST here to re-wrap everything under the active key
 *   5. Once GET reports no stale rows, drop the old key from the env
 *
 * GET  → report how many rows are on which key version (safe, read-only)
 * POST → re-encrypt stale rows under the active key
 */
export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;

  if (!isCryptoConfigured()) {
    return NextResponse.json({ error: "Credential encryption is not configured." }, { status: 503 });
  }

  const rows = await prisma.integration.groupBy({
    by: ["secretsKeyVer"],
    _count: { _all: true },
  });

  const active = activeKeyVersion();
  return NextResponse.json({
    activeKeyVersion: active,
    byVersion: rows.map((r) => ({
      keyVersion: r.secretsKeyVer,
      count: r._count._all,
      stale: r.secretsKeyVer !== null && r.secretsKeyVer !== active,
    })),
    staleCount: rows
      .filter((r) => r.secretsKeyVer !== null && r.secretsKeyVer !== active)
      .reduce((n, r) => n + r._count._all, 0),
  });
}

export async function POST(_req: NextRequest) {
  const denied = await requireOwner();
  if (denied) return denied;

  if (!isCryptoConfigured()) {
    return NextResponse.json({ error: "Credential encryption is not configured." }, { status: 503 });
  }

  const active = activeKeyVersion();
  const stale = await prisma.integration.findMany({
    where: {
      secretsCipher: { not: null },
      NOT: { secretsKeyVer: active },
    },
  });

  let rewrapped = 0;
  const failed: { id: string; provider: string; reason: string }[] = [];

  for (const integration of stale) {
    try {
      const secrets = openSecrets(integration, integration.businessProfileId, integration.provider);
      const sealed = sealSecrets(secrets, integration.businessProfileId, integration.provider);
      await prisma.integration.update({ where: { id: integration.id }, data: sealed });
      rewrapped += 1;
    } catch (err) {
      // A row whose old key is already gone from the keyring can't be saved —
      // report it so the operator knows those tenants must reconnect, rather
      // than failing the whole sweep.
      failed.push({
        id: integration.id,
        provider: integration.provider,
        reason: (err as Error).message,
      });
    }
  }

  return NextResponse.json({ ok: true, activeKeyVersion: active, rewrapped, failed });
}

async function requireOwner(): Promise<NextResponse | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isComplimentaryUser(session.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
