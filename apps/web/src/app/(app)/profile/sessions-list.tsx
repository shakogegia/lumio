"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Laptop } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { parseUserAgent } from "./parse-user-agent";

/** Serializable session shape passed from the server page. */
export interface SessionRow {
  id: string;
  token: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export function SessionsList({
  sessions,
  currentToken,
}: {
  sessions: SessionRow[];
  currentToken: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const others = sessions.filter((s) => s.token !== currentToken);

  async function revoke(token: string) {
    setError(null);
    setBusy(token);
    try {
      const { error } = await authClient.revokeSession({ token });
      if (error) {
        setError(error.message ?? "Could not sign out that session.");
        return;
      }
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function revokeOthers() {
    setError(null);
    setBusy("others");
    try {
      const { error } = await authClient.revokeOtherSessions();
      if (error) {
        setError(error.message ?? "Could not sign out the other sessions.");
        return;
      }
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-foreground/10">
        {sessions.map((s) => {
          const { browser, os } = parseUserAgent(s.userAgent);
          const isCurrent = s.token === currentToken;
          return (
            <li
              key={s.id}
              className="flex items-center justify-between gap-4 py-3"
            >
              <div className="flex items-center gap-3">
                <Laptop className="size-5 text-muted-foreground" />
                <div className="space-y-0.5">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {browser} · {os}
                    {isCurrent && <Badge variant="secondary">This device</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {s.ipAddress ?? "Unknown IP"} · signed in{" "}
                    {new Date(s.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
              {!isCurrent && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => revoke(s.token)}
                >
                  {busy === s.token ? "Signing out…" : "Sign out"}
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      {others.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={revokeOthers}
        >
          {busy === "others" ? "Signing out…" : "Sign out all other devices"}
        </Button>
      )}
    </div>
  );
}
