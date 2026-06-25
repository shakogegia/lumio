"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Check, MoreHorizontal, Trash2, Link2, Lock, Clock } from "lucide-react";
import type { ShareLinkSummaryDTO } from "@lumio/shared";
import { catalogApiUrl } from "@/lib/catalog-api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { useConfirm } from "@/components/confirm-dialog";

export function SharedLinksList({ slug, rows }: { slug: string; rows: ShareLinkSummaryDTO[] }) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [items, setItems] = useState(rows);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Resync when the server list changes (create/revoke/refresh).
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setItems(rows);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [rows]);

  async function copy(row: ShareLinkSummaryDTO) {
    try {
      await navigator.clipboard.writeText(row.url);
      setCopiedId(row.id);
      setTimeout(() => setCopiedId((id) => (id === row.id ? null : id)), 2000);
    } catch {
      toast.error("Couldn't copy — select the link and copy it manually.");
    }
  }

  async function revoke(row: ShareLinkSummaryDTO) {
    const ok = await confirm({
      title: "Revoke link?",
      description: "The link will stop working immediately. This cannot be undone.",
      confirmLabel: "Revoke",
      destructive: true,
    });
    if (!ok) return;
    const prev = items;
    setItems((list) => list.filter((r) => r.id !== row.id));
    try {
      const res = await fetch(`${catalogApiUrl(slug, "/share-links")}/${row.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setItems(prev);
      toast.error("Failed to revoke link");
    }
  }

  if (items.length === 0) {
    return (
      <>
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-border px-4 py-10 text-center text-sm text-muted-foreground">
          <Link2 className="size-6 opacity-50" aria-hidden />
          No shared links yet. Select photos and choose Share to create one.
        </div>
        {confirmDialog}
      </>
    );
  }

  return (
    <>
      <ItemGroup className="gap-2.5">
        {items.map((row) => (
          <Item key={row.id} variant="outline" className="bg-card">
            <ItemContent className="min-w-0">
              <ItemTitle className="truncate">{row.title ?? "Untitled link"}</ItemTitle>
              <ItemDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  {row.photoCount} photo{row.photoCount === 1 ? "" : "s"}
                </span>
                {row.hasPassword && (
                  <span className="inline-flex items-center gap-1">
                    <Lock className="size-3" aria-hidden /> Password
                  </span>
                )}
                {row.expiresAt && (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="size-3" aria-hidden />
                    {row.isExpired
                      ? "Expired"
                      : `Expires ${new Date(row.expiresAt).toLocaleDateString()}`}
                  </span>
                )}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void copy(row)}
                aria-label="Copy link"
              >
                {copiedId === row.id ? <Check aria-hidden /> : <Copy aria-hidden />}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Actions">
                    <MoreHorizontal aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem variant="destructive" onSelect={() => void revoke(row)}>
                    <Trash2 aria-hidden />
                    Revoke
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
      {confirmDialog}
    </>
  );
}
