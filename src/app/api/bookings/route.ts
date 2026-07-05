import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentProfileId } from "@/lib/tenant";
import { createBooking, bookingsForPhone } from "@/lib/bookings";
import type { BookingStatus, BookingType } from "@prisma/client";
import type { LineItemInput } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) return NextResponse.json({ bookings: [] });

  const phone = req.nextUrl.searchParams.get("phone");
  const ref = req.nextUrl.searchParams.get("ref");
  const status = req.nextUrl.searchParams.get("status") as BookingStatus | null;

  // Reference lookup → a single order/booking by its number.
  if (ref) {
    const booking = await prisma.booking.findFirst({
      where: { businessProfileId, reference: { equals: ref.trim().toUpperCase(), mode: "insensitive" } },
      include: { customer: true },
    });
    return NextResponse.json({ bookings: booking ? [booking] : [] });
  }

  // Phone lookup → that customer's full history (the call-back tracking path).
  if (phone) {
    const { customer, bookings } = await bookingsForPhone(businessProfileId, phone);
    return NextResponse.json({ customer, bookings });
  }

  const bookings = await prisma.booking.findMany({
    where: { businessProfileId, ...(status ? { status } : {}) },
    include: { customer: true },
    orderBy: { scheduledAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ bookings });
}

export async function POST(req: NextRequest) {
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json()) as {
    phone?: string;
    name?: string;
    email?: string;
    type?: BookingType;
    scheduledAt?: string;
    items?: LineItemInput[];
    province?: string;
    notes?: string;
  };

  if (!body.phone || !body.scheduledAt) {
    return NextResponse.json({ error: "phone and scheduledAt are required" }, { status: 400 });
  }

  // Province falls back to the business's default jurisdiction.
  const profile = await prisma.businessProfile.findUnique({
    where: { id: businessProfileId },
    select: { province: true },
  });

  const booking = await createBooking({
    businessProfileId,
    phone: body.phone.trim(),
    name: body.name,
    email: body.email,
    type: body.type ?? "ORDER",
    scheduledAt: body.scheduledAt,
    items: body.items ?? [],
    province: body.province || profile?.province || "ON",
    notes: body.notes,
  });

  return NextResponse.json({ booking });
}
