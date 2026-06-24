"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, KeyRound, Pencil, Trash2, X } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Serializable passkey shape passed from the server page. `label` is resolved
 * server-side (user name → authenticator model name → "Passkey") so we don't
 * pull the server-only `@better-auth/passkey` entry into the client bundle.
 */
export interface PasskeyRow {
  id: string;
  name: string | null; // raw user-set name, used to seed the rename field
  label: string;
  createdAt: string | null; // ISO
}

export function PasskeyList({ passkeys }: { passkeys: PasskeyRow[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    setAdding(true);
    try {
      // addPasskey runs the WebAuthn ceremony in the browser and resolves with
      // { error } on failure (it never throws per the SDK contract).
      const { error } = await authClient.passkey.addPasskey();
      if (error) {
        setError(error.message ?? "Could not add a passkey.");
        return;
      }
      router.refresh();
    } catch {
      // A throw means the browser lacks WebAuthn or the native prompt was
      // dismissed before the SDK could surface an error object.
      setError("Passkey setup was cancelled or isn’t supported on this device.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-4">
      {passkeys.length > 0 ? (
        <ul className="divide-y divide-foreground/10">
          {passkeys.map((p) => (
            <PasskeyItem key={p.id} passkey={p} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No passkeys yet.</p>
      )}

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <Button variant="outline" size="sm" disabled={adding} onClick={add}>
        <KeyRound />
        {adding ? "Waiting for your device…" : "Add passkey"}
      </Button>
    </div>
  );
}

function PasskeyItem({ passkey }: { passkey: PasskeyRow }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(passkey.name ?? passkey.label);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError("Name can’t be empty.");
      return;
    }
    setError(null);
    setBusy("save");
    try {
      const { error } = await authClient.passkey.updatePasskey({
        id: passkey.id,
        name: trimmed,
      });
      if (error) {
        setError(error.message ?? "Could not rename the passkey.");
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setError(null);
    setBusy("delete");
    try {
      const { error } = await authClient.passkey.deletePasskey({
        id: passkey.id,
      });
      if (error) {
        setError(error.message ?? "Could not remove the passkey.");
        return;
      }
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  function cancelEdit() {
    setEditing(false);
    setName(passkey.name ?? passkey.label);
    setError(null);
  }

  return (
    <li className="py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <KeyRound className="size-5 shrink-0 text-muted-foreground" />
          {editing ? (
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="h-8 max-w-56"
              aria-label="Passkey name"
            />
          ) : (
            <div className="min-w-0 space-y-0.5">
              <p className="truncate text-sm font-medium">{passkey.label}</p>
              {passkey.createdAt && (
                <p className="text-xs text-muted-foreground">
                  Added {new Date(passkey.createdAt).toLocaleDateString()}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {editing ? (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={busy !== null}
                onClick={save}
                aria-label="Save name"
              >
                <Check className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={busy !== null}
                onClick={cancelEdit}
                aria-label="Cancel rename"
              >
                <X className="size-4" />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={busy !== null}
                onClick={() => setEditing(true)}
                aria-label="Rename passkey"
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={busy !== null}
                onClick={remove}
                aria-label="Remove passkey"
              >
                <Trash2 className="size-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-1 text-destructive text-xs">
          {error}
        </p>
      )}
    </li>
  );
}
