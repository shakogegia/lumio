"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { FeatureKey, FieldType, type MetadataSchema } from "@lumio/shared";
import { postJson } from "@/lib/http";
import { apiPaths } from "@/lib/api-paths";
import { catalogApiUrl } from "@/lib/catalog-api";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const typeLabel = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

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

  async function patchField(fieldId: string, data: Record<string, unknown>) {
    await postJson(catalogApiUrl(slug, `/metadata/fields/${fieldId}`), data, "PATCH");
    router.refresh();
  }

  async function deleteField(fieldId: string) {
    setBusy(true);
    try {
      await postJson(catalogApiUrl(slug, `/metadata/fields/${fieldId}`), {}, "DELETE");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function addField(groupId: string, label: string, type: string) {
    await postJson(catalogApiUrl(slug, "/metadata/fields"), { groupId, label, type });
    router.refresh();
  }

  async function addGroup() {
    const label = window.prompt("New group name")?.trim();
    if (!label) return;
    setBusy(true);
    try {
      await postJson(catalogApiUrl(slug, "/metadata/groups"), { label });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const hasGroups = schema.length > 0;

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
              {hasGroups
                ? "Fields filled per photo in the Info tab."
                : "Start from the Negative Lab Pro preset."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {!hasGroups ? (
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={applyPreset}>Apply Negative Lab Pro preset</Button>
                <Button variant="outline" disabled={busy} onClick={() => void addGroup()}>Add group</Button>
              </div>
            ) : (
              <>
                {schema.map((group) => (
                  <div key={group.id} className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Field</TableHead>
                          <TableHead className="w-32">Type</TableHead>
                          <TableHead className="w-14">On</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.fields.map((f) => (
                          <Fragment key={f.id}>
                            <TableRow>
                              <TableCell>
                                <Input
                                  defaultValue={f.label}
                                  onBlur={(e) => {
                                    const label = e.target.value.trim();
                                    if (label && label !== f.label) void patchField(f.id, { label });
                                  }}
                                  className="h-8"
                                />
                              </TableCell>
                              <TableCell>
                                <Select value={f.type} onValueChange={(v) => void patchField(f.id, { type: v })}>
                                  <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {Object.values(FieldType).map((t) => (
                                      <SelectItem key={t} value={t}>{typeLabel(t)}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                <Switch
                                  checked={f.enabled}
                                  onCheckedChange={(v) => void patchField(f.id, { enabled: v })}
                                  aria-label={`${f.label} enabled`}
                                />
                              </TableCell>
                              <TableCell>
                                <Button variant="ghost" size="icon-sm" aria-label={`Delete ${f.label}`} disabled={busy} onClick={() => void deleteField(f.id)}>
                                  <Trash2 aria-hidden />
                                </Button>
                              </TableCell>
                            </TableRow>
                            {f.type === FieldType.Choice && (
                              <TableRow>
                                <TableCell colSpan={4} className="pt-0">
                                  <OptionsEditor options={f.options} onChange={(next) => void patchField(f.id, { options: next })} />
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        ))}
                      </TableBody>
                    </Table>
                    <AddField groupId={group.id} onAdd={addField} busy={busy} />
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => void addGroup()}>Add group</Button>
                  <Button variant="outline" size="sm" disabled={busy} onClick={clear}>Clear all fields</Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AddField({ groupId, onAdd, busy }: { groupId: string; onAdd: (groupId: string, label: string, type: string) => Promise<void>; busy: boolean }) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<string>(FieldType.Text);
  const submit = () => { const v = label.trim(); if (v) void onAdd(groupId, v, type).then(() => setLabel("")); };
  return (
    <div className="flex items-center gap-2 pt-1">
      <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Add field…" className="h-8 flex-1"
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
      <Select value={type} onValueChange={setType}>
        <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
        <SelectContent>
          {Object.values(FieldType).map((t) => (<SelectItem key={t} value={t}>{typeLabel(t)}</SelectItem>))}
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" disabled={busy || !label.trim()} onClick={submit}>Add</Button>
    </div>
  );
}

function OptionsEditor({ options, onChange }: { options: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map((o) => (
        <span key={o} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs">
          {o}
          <button type="button" aria-label={`Remove ${o}`} onClick={() => onChange(options.filter((x) => x !== o))} className="text-muted-foreground hover:text-foreground">×</button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="add option…"
        className="h-6 w-28 rounded-md border border-border bg-background px-2 text-xs"
        onKeyDown={(e) => { const v = draft.trim(); if (e.key === "Enter" && v && !options.includes(v)) { onChange([...options, v]); setDraft(""); } }}
      />
    </div>
  );
}
