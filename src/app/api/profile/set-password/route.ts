import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/profile/set-password
 * Sets an initial password for OAuth-only accounts (no credential account),
 * so social-signup users can also sign in with email + password. Better Auth
 * exposes this only as a server API — changePassword requires an existing
 * password, hence this route.
 */
export async function POST(req: NextRequest) {
  const hdrs = await headers();
  const session = await auth.api.getSession({ headers: hdrs });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { newPassword } = await req.json().catch(() => ({}));
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  try {
    await auth.api.setPassword({ body: { newPassword }, headers: hdrs });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error)?.message || "Could not set password." },
      { status: 400 },
    );
  }
}
