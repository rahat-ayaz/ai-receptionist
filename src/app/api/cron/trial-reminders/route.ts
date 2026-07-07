import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/twilio";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const now = new Date();
    
    // Fetch all users who don't have an active subscription
    const users = await prisma.user.findMany({
      include: {
        subscription: true,
      },
    });

    const trialUsers = users.filter((u) => {
      const hasSub = u.subscription && u.subscription.status !== "CANCELED";
      return !hasSub;
    });

    let sent3d = 0;
    let sent24h = 0;
    let sent3h = 0;

    const base = process.env.BETTER_AUTH_URL || process.env.APP_BASE_URL || "https://ai-receptionist-rho-three.vercel.app";

    for (const user of trialUsers) {
      const trialEndsAt = new Date(user.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
      const msRemaining = trialEndsAt.getTime() - now.getTime();
      const hoursRemaining = msRemaining / (1000 * 60 * 60);

      // 1) 3 Days Before Reminder (between 72 and 24 hours remaining)
      if (hoursRemaining <= 72 && hoursRemaining > 24 && !user.trial3dReminderSentAt) {
        await sendTrialReminder(user, "3 days", base);
        await prisma.user.update({
          where: { id: user.id },
          data: { trial3dReminderSentAt: now },
        });
        sent3d++;
      }
      
      // 2) 24 Hours Before Reminder (between 24 and 3 hours remaining)
      else if (hoursRemaining <= 24 && hoursRemaining > 3 && !user.trial24hReminderSentAt) {
        await sendTrialReminder(user, "24 hours", base);
        await prisma.user.update({
          where: { id: user.id },
          data: { trial24hReminderSentAt: now },
        });
        sent24h++;
      }
      
      // 3) 3 Hours Before Reminder (between 3 and 0 hours remaining)
      else if (hoursRemaining <= 3 && hoursRemaining > 0 && !user.trial3hReminderSentAt) {
        await sendTrialReminder(user, "3 hours", base);
        await prisma.user.update({
          where: { id: user.id },
          data: { trial3hReminderSentAt: now },
        });
        sent3h++;
      }
    }

    return NextResponse.json({
      ok: true,
      remindersSent: {
        "3d": sent3d,
        "24h": sent24h,
        "3h": sent3h,
      },
    });
  } catch (err: any) {
    console.error("[cron:trial-reminders] failed:", err);
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 });
  }
}

async function sendTrialReminder(
  user: { email: string; name?: string | null; phoneNumber?: string | null },
  timeLeft: string,
  baseUrl: string
) {
  const name = user.name || "there";
  const billingLink = `${baseUrl}/billing`;

  const emailSubject = `Your CAPRO free trial is ending in ${timeLeft}`;
  const emailBody = `Hi ${name},

This is a reminder that your 7-day CAPRO free trial will expire in ${timeLeft}. 

To prevent any service interruption to your AI receptionist and access to your dashboard, please choose a plan and subscribe.

Subscribe here: ${billingLink}

Thanks,
The CAPRO Team`;

  // 1) Send Email
  try {
    await sendEmail({
      to: user.email,
      subject: emailSubject,
      text: emailBody,
    });
  } catch (err: any) {
    console.error(`[trial-reminders] failed to send email to ${user.email}:`, err.message);
  }

  // 2) Send SMS
  if (user.phoneNumber) {
    const smsBody = `CAPRO Reminder: Your free trial is ending in ${timeLeft}. Subscribe now to keep your AI receptionist active: ${billingLink}`;
    try {
      await sendSms(user.phoneNumber, smsBody);
    } catch (err: any) {
      console.error(`[trial-reminders] failed to send SMS to ${user.phoneNumber}:`, err.message);
    }
  }
}
