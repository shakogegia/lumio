"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { useCatalog } from "@/components/providers/catalog-context";
import { catalogApiUrl } from "@/lib/catalog-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

enum Expiry {
  Never = "never",
  SevenDays = "7d",
  ThirtyDays = "30d",
}

const EXPIRY_DAYS: Record<Expiry, number | null> = {
  [Expiry.Never]: null,
  [Expiry.SevenDays]: 7,
  [Expiry.ThirtyDays]: 30,
};

function expiryToIso(value: Expiry): string | undefined {
  const days = EXPIRY_DAYS[value];
  if (days === null) return undefined;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export function ShareLinkDialog({
  ids,
  open,
  onOpenChange,
}: {
  ids: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { slug } = useCatalog();
  const [title, setTitle] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [expiry, setExpiry] = useState<Expiry>(Expiry.Never);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setTitle("");
    setAdvanced(false);
    setExpiry(Expiry.Never);
    setPassword("");
    setUrl(null);
    setCopied(false);
  }

  async function create() {
    if (pending || ids.length === 0) return;
    setPending(true);
    try {
      const res = await fetch(catalogApiUrl(slug, "/share-links"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          photoIds: ids,
          title: title.trim() || undefined,
          password: password.trim() || undefined,
          expiresAt: expiryToIso(expiry),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(data?.error ?? "Failed to create link");
        return;
      }
      const link = (await res.json()) as { url: string };
      setUrl(link.url);
    } catch {
      toast.error("Failed to create link");
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select the link and copy it manually.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (pending) return;
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share {ids.length} photo{ids.length === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>Anyone with the link can view and download these photos.</DialogDescription>
        </DialogHeader>

        {url ? (
          <div className="space-y-3">
            <Label htmlFor="share-url">Link</Label>
            <div className="flex gap-2">
              <Input id="share-url" readOnly value={url} className="font-mono text-xs" />
              <Button type="button" size="icon" variant="outline" onClick={() => void copy()} aria-label="Copy link">
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              </Button>
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="share-title">Title (optional)</Label>
              <Input
                id="share-title"
                autoFocus
                placeholder="e.g. Wedding photos"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {!advanced ? (
              <button
                type="button"
                onClick={() => setAdvanced(true)}
                className="text-sm text-muted-foreground underline-offset-4 hover:underline"
              >
                Advanced options
              </button>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="share-expiry">Expires</Label>
                  <Select value={expiry} onValueChange={(v) => setExpiry(v as Expiry)}>
                    <SelectTrigger id="share-expiry">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={Expiry.Never}>Never</SelectItem>
                      <SelectItem value={Expiry.SevenDays}>In 7 days</SelectItem>
                      <SelectItem value={Expiry.ThirtyDays}>In 30 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="share-password">Password (optional)</Label>
                  <Input
                    id="share-password"
                    type="password"
                    placeholder="Leave blank for none"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="submit" disabled={pending || ids.length === 0}>
                {pending ? "Creating…" : "Create link"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
