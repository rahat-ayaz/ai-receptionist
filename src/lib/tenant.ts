import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// ─── Current-tenant resolution ──────────────────────────────────────────────
// Helpers that resolve the signed-in user's BusinessProfile, replacing the old
// "first tenant" (findFirst) shortcuts now that auth scopes every request.

export async function currentUserId(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user.id ?? null;
}

export async function currentProfile() {
  const userId = await currentUserId();
  if (!userId) return null;
  return prisma.businessProfile.findUnique({ where: { userId } });
}

export async function currentProfileId(): Promise<string | null> {
  const profile = await currentProfile();
  return profile?.id ?? null;
}
