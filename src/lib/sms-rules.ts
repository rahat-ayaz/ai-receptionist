import { prisma } from "@/lib/prisma";
import { sendSms } from "@/lib/twilio";

interface RuleLike {
  id: string;
  matchKeywords: string[];
  messageTemplate: string;
  active: boolean;
}

/** Return rules whose keyword vectors match the given utterance. */
export function matchRules(text: string, rules: RuleLike[]): RuleLike[] {
  const haystack = text.toLowerCase();
  return rules.filter(
    (r) => r.active && r.matchKeywords.some((kw) => kw.trim() && haystack.includes(kw.toLowerCase().trim())),
  );
}

/** Interpolate {{tokens}} in a message template. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => vars[key] ?? "");
}

/**
 * Evaluate every active trigger rule for a business against a caller utterance
 * and dispatch matching SMS messages. Returns the number of messages sent.
 */
export async function dispatchTriggerSms(args: {
  businessProfileId: string;
  businessName: string;
  callerNumber: string;
  utterance: string;
  fireOn: "DURING_CALL" | "AFTER_CALL";
}): Promise<number> {
  const rules = await prisma.smsTriggerRule.findMany({
    where: { businessProfileId: args.businessProfileId, active: true, fireOn: args.fireOn },
  });

  const profile = await prisma.businessProfile.findUnique({
    where: { id: args.businessProfileId },
    select: {
      twilioNumbers: { where: { active: true }, select: { phoneNumber: true }, take: 1 },
    },
  });
  const fromOverride = profile?.twilioNumbers[0]?.phoneNumber ?? undefined;

  const matched = matchRules(args.utterance, rules);
  let sent = 0;

  for (const rule of matched) {
    const body = renderTemplate(rule.messageTemplate, {
      businessName: args.businessName,
      callerNumber: args.callerNumber,
    });
    try {
      const sid = await sendSms(args.callerNumber, body, fromOverride);
      if (sid) sent += 1;
    } catch (err) {
      console.error(`[sms-rules] failed to dispatch rule ${rule.id}:`, err);
    }
  }

  return sent;
}
