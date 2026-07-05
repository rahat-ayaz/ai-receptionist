import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { emailOTP, phoneNumber } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { prisma } from "./prisma";
import { sendEmail } from "./email";
import { sendSmsCode } from "./twilio";

// Resolve the public origin for passkeys / callbacks.
const BASE_URL = process.env.BETTER_AUTH_URL || "http://localhost:3210";
const RP_ID = new URL(BASE_URL).hostname; // "localhost" in dev

// Only register a social provider when both its id and secret are present, so
// the buttons can render in the UI without crashing auth when unconfigured.
function socialProviders() {
  const providers: Record<string, { clientId: string; clientSecret: string }> = {};
  const add = (key: string, id?: string, secret?: string) => {
    if (id && secret) providers[key] = { clientId: id, clientSecret: secret };
  };
  add("google", process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  add("github", process.env.GITHUB_CLIENT_ID, process.env.GITHUB_CLIENT_SECRET);
  add("facebook", process.env.FACEBOOK_CLIENT_ID, process.env.FACEBOOK_CLIENT_SECRET);
  return providers;
}

export const auth = betterAuth({
  baseURL: BASE_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: "postgresql" }),

  // Allow changing the account email, verified via a link to the current inbox.
  user: {
    changeEmail: {
      enabled: true,
      sendChangeEmailVerification: async ({
        user,
        newEmail,
        url,
      }: {
        user: { email: string };
        newEmail: string;
        url: string;
      }) => {
        await sendEmail({
          to: user.email,
          subject: "Confirm your new CAPRO email",
          text: `Approve changing your email to ${newEmail}:\n${url}`,
        });
      },
    },
  },

  emailVerification: {
    sendVerificationEmail: async ({
      user,
      url,
    }: {
      user: { email: string };
      url: string;
    }) => {
      await sendEmail({
        to: user.email,
        subject: "Verify your CAPRO email",
        text: `Verify your email using this link:\n${url}`,
      });
    },
  },

  // Email + password (email is the login identifier).
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({
      user,
      url,
    }: {
      user: { email: string };
      url: string;
    }) => {
      await sendEmail({
        to: user.email,
        subject: "Reset your CAPRO password",
        text: `Reset your password using this link:\n${url}`,
      });
    },
  },

  socialProviders: socialProviders(),

  plugins: [
    // Email verification + password reset via 6-digit OTP codes.
    emailOTP({
      otpLength: 6,
      expiresIn: 600,
      async sendVerificationOTP({ email, otp, type }) {
        const subject =
          type === "email-verification"
            ? "Your CAPRO verification code"
            : type === "forget-password"
              ? "Your CAPRO password reset code"
              : "Your CAPRO sign-in code";
        await sendEmail({
          to: email,
          subject,
          text: `Your CAPRO code is ${otp}. It expires in 10 minutes.`,
        });
      },
    }),

    // Phone verification via SMS OTP (Twilio, console fallback in dev).
    phoneNumber({
      otpLength: 6,
      expiresIn: 600,
      sendOTP: async ({ phoneNumber: to, code }) => {
        await sendSmsCode(to, `Your CAPRO verification code is ${code}.`);
      },
    }),

    // Passkey / WebAuthn.
    passkey({
      rpID: RP_ID,
      rpName: "CAPRO",
      origin: BASE_URL,
    }),

    // Must be last — lets server actions/route handlers set auth cookies.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
