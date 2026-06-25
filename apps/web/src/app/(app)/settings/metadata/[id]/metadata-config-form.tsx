"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FeatureKey, type MetadataSchema } from "@lumio/shared";
import { postJson } from "@/lib/http";
import { apiPaths } from "@/lib/api-paths";
import { catalogApiUrl } from "@/lib/catalog-api";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";

export function MetadataConfigForm({
  catalogId,
  slug,
  standardEnabled,
  customEnabled,
  customAvailable,
  schema,
}: {
  catalogId: string;
  slug: string;
  standardEnabled: boolean;
  customEnabled: boolean;
  customAvailable: boolean;
  schema: MetadataSchema;
}) {
  const router = useRouter();
  const [standard, setStandard] = useState(standardEnabled);
  const [custom, setCustom] = useState(customEnabled);
  const [busy, setBusy] = useState(false);

  async function toggleFeature(key: FeatureKey, next: boolean, set: (v: boolean) => void) {
    set(next);
    try {
      await postJson(apiPaths.features, { key, catalogId, enabled: next }, "PUT");
      router.refresh();
    } catch {
      set(!next);
    }
  }

  async function applyPreset() {
    setBusy(true);
    try {
      await postJson(catalogApiUrl(slug, "/metadata/apply-preset"), { presetId: "nlp" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      await postJson(catalogApiUrl(slug, "/metadata/clear"), {});
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const hasFields = schema.some((g) => g.fields.length > 0);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Display</CardTitle>
          <CardDescription>What appears on photos in this catalog.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="md-standard">Standard metadata</FieldLabel>
              <FieldDescription>Show camera, lens, and exposure from EXIF.</FieldDescription>
            </FieldContent>
            <Switch
              id="md-standard"
              checked={standard}
              onCheckedChange={(v) => toggleFeature(FeatureKey.StandardMetadata, v, setStandard)}
            />
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="md-custom">Custom metadata</FieldLabel>
              <FieldDescription>
                {customAvailable
                  ? "Enable user-defined fields (film stock, developer, …)."
                  : "Turn on Photo metadata globally (Settings → Features) to use this."}
              </FieldDescription>
            </FieldContent>
            <Switch
              id="md-custom"
              checked={custom}
              disabled={!customAvailable}
              onCheckedChange={(v) => toggleFeature(FeatureKey.Metadata, v, setCustom)}
            />
          </Field>
        </CardContent>
      </Card>

      {custom && customAvailable && (
        <Card>
          <CardHeader>
            <CardTitle>Custom fields</CardTitle>
            <CardDescription>
              {hasFields
                ? "Fields filled per photo in the Info tab."
                : "Start from the Negative Lab Pro preset."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {hasFields ? (
              <>
                <div className="space-y-4">
                  {schema
                    .filter((g) => g.fields.length > 0)
                    .map((group) => (
                      <div key={group.id} className="space-y-1.5">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {group.label}
                        </p>
                        <ul className="flex flex-wrap gap-1.5">
                          {group.fields.map((f) => (
                            <li
                              key={f.id}
                              className="rounded-md border border-border bg-background px-2 py-0.5 text-xs"
                            >
                              {f.label}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                </div>
                <Button variant="outline" size="sm" disabled={busy} onClick={clear}>
                  Clear all fields
                </Button>
              </>
            ) : (
              <Button disabled={busy} onClick={applyPreset}>
                Apply Negative Lab Pro preset
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
