// apps/web/src/app/(app)/settings/metadata/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { FeatureKey } from "@lumio/shared";
import { getGlobalFeatureStates, listCatalogs } from "@lumio/db";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Metadata" };

export default async function MetadataSettingsPage() {
  const features = await getGlobalFeatureStates();
  if (!(features.find((f) => f.key === FeatureKey.Metadata)?.enabled ?? false)) notFound();
  const catalogs = await listCatalogs();

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-4 py-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Metadata</h1>
        <p className="text-sm text-muted-foreground">
          Configure standard and custom photo metadata per catalog.
        </p>
      </div>
      {catalogs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No catalogs yet.</p>
      ) : (
        <ItemGroup className="gap-2.5">
          {catalogs.map((c) => (
            <Item key={c.id} asChild variant="outline" className="bg-card">
              <Link href={`/settings/metadata/${c.id}`}>
                <ItemContent className="min-w-0">
                  <ItemTitle className="truncate">{c.name}</ItemTitle>
                  <ItemDescription className="truncate font-mono text-xs">
                    {c.path}
                  </ItemDescription>
                </ItemContent>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
              </Link>
            </Item>
          ))}
        </ItemGroup>
      )}
    </main>
  );
}
