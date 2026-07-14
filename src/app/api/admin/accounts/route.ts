import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isComplimentaryUser } from "@/lib/billing";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/accounts — internal owner tooling, usable from a signed-in
 * browser. Guarded by TEST_ACCOUNT_EMAILS: only sessions whose email is on
 * that allowlist may use it (locked for everyone when the env var is unset).
 *
 *   GET /api/admin/accounts                         → list all accounts
 *   GET /api/admin/accounts?delete=<id>&confirm=yes → hard-delete a user
 *                                                     (cascades to profile,
 *                                                     calls, bookings, numbers)
 */
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isComplimentaryUser(session.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const del = req.nextUrl.searchParams.get("delete");
  if (del) {
    if (del === session.user.id) {
      return NextResponse.json(
        { error: "Refusing to delete the account you are signed in with." },
        { status: 400 },
      );
    }
    if (req.nextUrl.searchParams.get("confirm") !== "yes") {
      return NextResponse.json(
        { error: "Deletion is irreversible. Re-request with &confirm=yes to proceed." },
        { status: 400 },
      );
    }
    const deleted = await prisma.user
      .delete({ where: { id: del }, select: { id: true, email: true } })
      .catch(() => null);
    if (!deleted) return NextResponse.json({ error: "User not found." }, { status: 404 });
    return NextResponse.json({ deleted });
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      createdAt: true,
      subscription: { select: { status: true } },
      businessProfile: {
        select: {
          id: true,
          name: true,
          twilioNumbers: { select: { phoneNumber: true, active: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // Host only (never credentials) — identifies where production data lives.
  let dbHost = "unknown";
  try {
    dbHost = new URL(process.env.DATABASE_URL || "").host;
  } catch { /* leave unknown */ }

  return NextResponse.json({ dbHost, you: session.user.email, users });
}
