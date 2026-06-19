import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { createAuthMiddleware } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";
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

// Secure cookies only travel over HTTPS. Set USE_SECURE_COOKIES=false to keep
// logins working over plain HTTP (e.g. http://<lan-ip>:3000 or a raw Tailscale
// IP). Unset → Better Auth's default (Secure in production). ⚠️ Disabling drops
// the Secure flag on ALL origins, including any public HTTPS domain, so only do
// it on a trusted LAN/Tailscale-only deployment. The proxy gate reads the token
// under either cookie name, so flipping this doesn't break the redirect gate.
const secureCookiesEnv = process.env.USE_SECURE_COOKIES;

export const auth = betterAuth({
  baseURL,
  appName: "Lumio",
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins,
  session: {
    // Validate a signed session cookie instead of querying Postgres on every
    // request. Removes the per-thumbnail / per-display DB session lookup. A
    // revoked session stays valid until this TTL expires.
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  ...(secureCookiesEnv !== undefined && {
    advanced: { useSecureCookies: secureCookiesEnv !== "false" },
  }),
  plugins: [twoFactor()],
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
