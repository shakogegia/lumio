// apps/web/src/app/(app)/settings/metadata/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { FeatureKey } from "@lumio/shared";
import { getGlobalFeatureStates, listCatalogs } from "@lumio/db";
import { Card, CardContent } from "@/components/ui/card";

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
      <Card>
        <CardContent className="divide-y p-0">
          {catalogs.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No catalogs yet.</p>
          ) : (
            catalogs.map((c) => (
              <Link
                key={c.id}
                href={`/settings/metadata/${c.id}`}
                className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-muted"
              >
                <span className="font-medium">{c.name}</span>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </main>
  );
}
