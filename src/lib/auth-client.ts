"use client";

import { createAuthClient } from "better-auth/react";
import { emailOTPClient, phoneNumberClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL || undefined,
  plugins: [emailOTPClient(), phoneNumberClient(), passkeyClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
