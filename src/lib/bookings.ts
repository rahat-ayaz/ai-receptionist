import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { sendSmsCode } from "@/lib/twilio";
import { priceOrder, type LineItem, type LineItemInput } from "@/lib/pricing";
import { normalizeProvince } from "@/lib/tax";
import { applyTokens, renderBrandedEmail } from "@/lib/branding";
import type { BookingType, BookingStatus, Booking, Customer } from "@prisma/client";

const money = (n: number) => `$${n.toFixed(2)}`;

/** Resolve a customer by phone within a tenant, creating one if new. */
export async function getOrCreateCustomer(
  businessProfileId: string,
  phone: string,
  info: { name?: string | null; email?: string | null } = {},
): Promise<Customer> {
  const existing = await prisma.customer.findUnique({
    where: { businessProfileId_phone: { businessProfileId, phone } },
  });
  if (existing) {
    // Backfill name/email if we learned them on a later contact.
    if ((info.name && !existing.name) || (info.email && !existing.email)) {
      return prisma.customer.update({
        where: { id: existing.id },
        data: { name: existing.name ?? info.name ?? null, email: existing.email ?? info.email ?? null },
      });
    }
    return existing;
  }
  return prisma.customer.create({
    data: { businessProfileId, phone, name: info.name ?? null, email: info.email ?? null },
  });
}

export interface CreateBookingInput {
  businessProfileId: string;
  phone: string;
  name?: string | null;
  email?: string | null;
  type: BookingType;
  scheduledAt: string | Date;
  items: LineItemInput[];
  province: string;
  notes?: string | null;
}

/** Create a PENDING booking, pricing the order and resolving the customer. */
export async function createBooking(input: CreateBookingInput): Promise<Booking> {
  const customer = await getOrCreateCustomer(input.businessProfileId, input.phone, {
    name: input.name,
    email: input.email,
  });
  const priced = priceOrder(input.items, input.province);

  // Atomically claim the next per-tenant number → human-friendly reference.
  const { bookingCounter } = await prisma.businessProfile.update({
    where: { id: input.businessProfileId },
    data: { bookingCounter: { increment: 1 } },
    select: { bookingCounter: true },
  });
  const reference = `${input.type === "ORDER" ? "ORD" : "APT"}-${String(bookingCounter).padStart(4, "0")}`;

  return prisma.booking.create({
    data: {
      businessProfileId: input.businessProfileId,
      customerId: customer.id,
      reference,
      type: input.type,
      status: "PENDING",
      scheduledAt: new Date(input.scheduledAt),
      lineItems: priced.lineItems as object[],
      subtotal: priced.subtotal,
      taxAmount: priced.tax.amount,
      total: priced.total,
      taxLabel: priced.tax.label,
      province: priced.tax.province,
      notes: input.notes ?? null,
    },
  });
}

export interface ModifyBookingPatch {
  status?: BookingStatus;
  scheduledAt?: string | Date;
  items?: LineItemInput[];
  province?: string;
  notes?: string | null;
}

/** Modify a booking (reschedule / cancel / confirm / edit items) within a tenant. */
export async function modifyBooking(
  id: string,
  businessProfileId: string,
  patch: ModifyBookingPatch,
): Promise<Booking | null> {
  const existing = await prisma.booking.findFirst({ where: { id, businessProfileId } });
  if (!existing) return null;

  const data: Record<string, unknown> = {};
  if (patch.notes !== undefined) data.notes = patch.notes;
  if (patch.scheduledAt) data.scheduledAt = new Date(patch.scheduledAt);
  if (patch.status) data.status = patch.status;

  // Recompute totals if the items or province changed.
  if (patch.items || patch.province) {
    const items = patch.items ?? (existing.lineItems as unknown as LineItem[]);
    const province = normalizeProvince(patch.province ?? existing.province);
    const priced = priceOrder(items, province);
    data.lineItems = priced.lineItems as object[];
    data.subtotal = priced.subtotal;
    data.taxAmount = priced.tax.amount;
    data.total = priced.total;
    data.taxLabel = priced.tax.label;
    data.province = priced.tax.province;
  }

  return prisma.booking.update({ where: { id }, data });
}

/** All bookings for a caller, newest first — the "track everything by phone" lookup. */
export async function bookingsForPhone(businessProfileId: string, phone: string) {
  const customer = await prisma.customer.findUnique({
    where: { businessProfileId_phone: { businessProfileId, phone } },
  });
  if (!customer) return { customer: null, bookings: [] };
  const bookings = await prisma.booking.findMany({
    where: { businessProfileId, customerId: customer.id },
    orderBy: { scheduledAt: "desc" },
  });
  return { customer, bookings };
}

/** Human-readable confirmation/reminder message for a booking. */
export function formatBookingMessage(
  booking: Pick<Booking, "type" | "reference" | "scheduledAt" | "lineItems" | "subtotal" | "taxAmount" | "total" | "taxLabel" | "status">,
  businessName: string,
  kind: "confirmation" | "reminder" | "update" | "cancelled" = "confirmation",
): string {
  const when = new Date(booking.scheduledAt).toLocaleString("en-CA", {
    timeZone: "America/Toronto",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const items = (booking.lineItems as unknown as LineItem[]) ?? [];
  const itemsLine = items.length
    ? items.map((i) => `${i.qty} × ${i.name} (${money(i.lineTotal)})`).join(", ")
    : null;
  const noun = booking.type === "ORDER" ? "order" : "appointment";

  const ref = booking.reference ? ` (${booking.reference})` : "";
  const lead =
    kind === "reminder"
      ? `Reminder: your ${noun}${ref} with ${businessName} is coming up ${when}.`
      : kind === "cancelled" || booking.status === "CANCELLED"
      ? `Your ${noun}${ref} with ${businessName} has been cancelled.`
      : kind === "update"
      ? `Your ${noun}${ref} with ${businessName} has been updated for ${when}.`
      : `Your ${noun}${ref} with ${businessName} is confirmed for ${when}.`;

  const totals =
    booking.total > 0 && (kind !== "cancelled" && booking.status !== "CANCELLED")
      ? ` Total ${money(booking.total)} (incl. ${booking.taxLabel} ${money(booking.taxAmount)}).`
      : "";

  return [lead, itemsLine && (kind !== "cancelled" && booking.status !== "CANCELLED") ? ` Items: ${itemsLine}.` : "", totals].join("");
}

/**
 * Send a booking confirmation by email + SMS (console fallback when keys are
 * unset) and mark it CONFIRMED. Returns the updated booking.
 */
export async function sendBookingConfirmation(
  id: string,
  businessProfileId: string,
  isUpdate = false,
): Promise<Booking | null> {
  const booking = await prisma.booking.findFirst({
    where: { id, businessProfileId },
    include: { customer: true, businessProfile: true },
  });
  if (!booking) return null;

  const bp = booking.businessProfile;
  const items = (booking.lineItems as unknown as LineItem[]) ?? [];
  const noun = booking.type === "ORDER" ? "order" : "appointment";
  const when = new Date(booking.scheduledAt).toLocaleString("en-CA", {
    timeZone: "America/Toronto",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  // Token values available to templates.
  const vars: Record<string, string> = {
    businessName: bp.name,
    customerName: booking.customer.name || "there",
    reference: booking.reference ?? "",
    type: noun,
    when,
    items: items.map((i) => `${i.qty}× ${i.name}`).join(", "),
    subtotal: money(booking.subtotal),
    tax: money(booking.taxAmount),
    taxLabel: booking.taxLabel,
    total: money(booking.total),
  };

  // Use the tenant's designated confirmation templates if present, else defaults.
  const templates = await prisma.messageTemplate.findMany({
    where: { businessProfileId, purpose: "BOOKING_CONFIRMATION" },
  });
  const emailTpl = templates.find((t) => t.channel === "EMAIL");
  const smsTpl = templates.find((t) => t.channel === "SMS");
  
  const isCancelled = booking.status === "CANCELLED";
  const fallback = formatBookingMessage(booking, bp.name, isCancelled ? "cancelled" : isUpdate ? "update" : "confirmation");

  // Email — branded HTML, template-driven when configured.
  if (booking.customer.email) {
    const defaultSubject = isCancelled
      ? `Your ${bp.name} ${noun} is cancelled`
      : isUpdate
      ? `Your ${bp.name} ${noun} is updated`
      : `Your ${bp.name} ${noun} is confirmed`;
    const subject = emailTpl?.subject ? applyTokens(emailTpl.subject, vars) : defaultSubject;
    const bodyText = emailTpl ? applyTokens(emailTpl.body, vars) : fallback;
    const emailItems = isCancelled ? [] : ((booking.lineItems as unknown as { name: string; qty: number; unitPrice: number; lineTotal: number }[]) || []);

    await sendEmail({
      to: booking.customer.email,
      subject,
      text: bodyText.replace(/\\n/g, "\n"),
      html: renderBrandedEmail({
        brand: bp,
        businessName: bp.name,
        heading: subject,
        body: bodyText,
        items: emailItems,
        subtotal: isCancelled ? 0 : booking.subtotal,
        taxAmount: isCancelled ? 0 : booking.taxAmount,
        taxLabel: booking.taxLabel,
        total: isCancelled ? 0 : booking.total
      }),
    });
  }

  // SMS — template-driven when configured (plain text).
  const smsBody = smsTpl ? applyTokens(smsTpl.body, vars) : fallback;
  await sendSmsCode(booking.customer.phone, smsBody.replace(/\\n/g, "\n"));

  return prisma.booking.update({
    where: { id },
    data: {
      confirmationSentAt: new Date(),
      status: booking.status === "PENDING" ? "CONFIRMED" : booking.status,
    },
  });
}
