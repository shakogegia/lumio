import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { createAuthMiddleware } from "better-auth/api";
import { prisma, hasAnyUser } from "@lumio/db";
import { assertSignupAllowed } from "./signup-gate.js";

const baseURL = process.env.BETTER_AUTH_URL;

export const auth = betterAuth({
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: baseURL ? [baseURL] : [],
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Permanently close account creation after the first user — this guards
      // the raw endpoint regardless of how it's called.
      assertSignupAllowed(ctx.path, await hasAnyUser());
    }),
  },
});
