"use client";
// Client-only. Server code reads sessions via @/lib/server-session, not this module.

import { createAuthClient } from "better-auth/react";

// No baseURL → defaults to the current origin, so it works in dev and behind
// the Cloudflare tunnel without a public env var.
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
