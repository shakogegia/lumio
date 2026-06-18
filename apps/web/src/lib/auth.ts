import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { createAuthMiddleware } from "better-auth/api";
import { prisma, hasAnyUser } from "@lumio/db";
import { assertSignupAllowed } from "./signup-gate.js";

const baseURL = process.env.BETTER_AUTH_URL;

// Extra origins to trust for CSRF beyond baseURL — comma-separated. Lets a
// Conductor workspace accept BOTH its portless subdomain (the baseURL) and the
// direct http://localhost:<port> origin. Empty in plain/prod setups.
// Note: cookies are Secure (set via the https baseURL), so they won't flow over
// the http://localhost:<port> origin — direct-port access is handy for API
// tooling/tests but not for full browser sessions; use the subdomain for those.
const extraTrustedOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const trustedOrigins = [
  ...new Set([...(baseURL ? [baseURL] : []), ...extraTrustedOrigins]),
];

export const auth = betterAuth({
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins,
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
