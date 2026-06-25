// apps/web/src/app/(app)/settings/metadata/[id]/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { FeatureKey } from "@lumio/shared";
import { getCatalogById, getCatalogFeatureStates, getCatalogSchema } from "@lumio/db";
import { MetadataConfigForm } from "./metadata-config-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Catalog metadata" };

export default async function CatalogMetadataPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const catalog = await getCatalogById(id);
  if (!catalog) notFound();

  const featureStates = await getCatalogFeatureStates(catalog.id);
  const standard = featureStates.find((f) => f.key === FeatureKey.StandardMetadata);
  const custom = featureStates.find((f) => f.key === FeatureKey.Metadata);
  const schema = await getCatalogSchema(catalog.id);

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-4 py-8">
      <div className="space-y-2">
        <nav className="flex items-center gap-1 text-sm text-muted-foreground">
          <Link href="/settings/metadata" className="transition-colors hover:text-foreground">
            Metadata
          </Link>
          <ChevronRight className="size-3.5" aria-hidden />
          <span className="text-foreground">{catalog.name}</span>
        </nav>
        <h1 className="text-2xl font-semibold tracking-tight">{catalog.name}</h1>
      </div>

      <MetadataConfigForm
        catalogId={catalog.id}
        slug={catalog.slug}
        standardEnabled={standard?.catalogEnabled ?? true}
        customEnabled={(custom?.globalEnabled ?? false) && (custom?.catalogEnabled ?? true)}
        customAvailable={custom?.globalEnabled ?? false}
        schema={schema}
      />
    </main>
  );
}
