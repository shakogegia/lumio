"use client";

import { useState } from "react";
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
import { ChevronDown, ChevronUp, Trash2, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { invalidateMetadataSchema } from "@/features/lightbox/use-metadata-schema";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  const refresh = () => {
    invalidateMetadataSchema(slug);
    router.refresh();
  };
  const [standard, setStandard] = useState(standardEnabled);
  const [custom, setCustom] = useState(customEnabled);
  const [busy, setBusy] = useState(false);
  const [addGroupOpen, setAddGroupOpen] = useState(false);

  async function toggleFeature(key: FeatureKey, next: boolean, set: (v: boolean) => void) {
    set(next);
    try {
      await postJson(apiPaths.features, { key, catalogId, enabled: next }, "PUT");
      refresh();
    } catch {
      set(!next);
    }
  }

  async function applyPreset() {
    setBusy(true);
    try {
      await postJson(catalogApiUrl(slug, "/metadata/apply-preset"), { presetId: "nlp" });
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      await postJson(catalogApiUrl(slug, "/metadata/clear"), {});
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function patchField(fieldId: string, data: Record<string, unknown>) {
    await postJson(catalogApiUrl(slug, `/metadata/fields/${fieldId}`), data, "PATCH");
    refresh();
  }

  async function deleteField(fieldId: string) {
    setBusy(true);
    try {
      await postJson(catalogApiUrl(slug, `/metadata/fields/${fieldId}`), {}, "DELETE");
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function addField(groupId: string, label: string, type: string) {
    await postJson(catalogApiUrl(slug, "/metadata/fields"), { groupId, label, type });
    refresh();
  }

  async function addGroup(label: string) {
    setBusy(true);
    try {
      await postJson(catalogApiUrl(slug, "/metadata/groups"), { label });
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function reorder(kind: "field" | "group", movedId: string, afterId: string | null) {
    setBusy(true);
    try {
      await postJson(catalogApiUrl(slug, "/metadata/reorder"), { kind, movedId, afterId });
      refresh();
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
                ? "Filled per photo in the Info tab."
                : "Start from the Negative Lab Pro preset, or add your own group."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {!hasGroups ? (
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => void applyPreset()}>
                  Apply Negative Lab Pro preset
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => setAddGroupOpen(true)}>
                  Add group
                </Button>
              </div>
            ) : (
              <>
                {schema.map((group, gi) => (
                  <div key={group.id} className="space-y-2">
                    <div className="flex items-center gap-1">
                      <p className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
                      <Button variant="ghost" size="icon-sm" aria-label="Move group up" disabled={busy || gi === 0}
                        onClick={() => void reorder("group", group.id, gi >= 2 ? schema[gi - 2]!.id : null)}>
                        <ChevronUp aria-hidden />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label="Move group down" disabled={busy || gi === schema.length - 1}
                        onClick={() => void reorder("group", group.id, schema[gi + 1]!.id)}>
                        <ChevronDown aria-hidden />
                      </Button>
                    </div>
                    <div className="space-y-1.5">
                      {group.fields.map((f, fi) => (
                        <div key={f.id} className="rounded-lg border bg-card px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Input
                              defaultValue={f.label}
                              onBlur={(e) => {
                                const label = e.target.value.trim();
                                if (label && label !== f.label) void patchField(f.id, { label });
                              }}
                              className="h-8 flex-1"
                            />
                            <Select value={f.type} onValueChange={(v) => void patchField(f.id, { type: v })}>
                              <SelectTrigger size="sm" className="w-28">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  {Object.values(FieldType).map((t) => (
                                    <SelectItem key={t} value={t}>
                                      {typeLabel(t)}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                            <Switch
                              checked={f.enabled}
                              onCheckedChange={(v) => void patchField(f.id, { enabled: v })}
                              aria-label={`${f.label} enabled`}
                            />
                            <Button variant="ghost" size="icon-sm" aria-label={`Move ${f.label} up`} disabled={busy || fi === 0}
                              onClick={() => void reorder("field", f.id, fi >= 2 ? group.fields[fi - 2]!.id : null)}>
                              <ChevronUp aria-hidden />
                            </Button>
                            <Button variant="ghost" size="icon-sm" aria-label={`Move ${f.label} down`} disabled={busy || fi === group.fields.length - 1}
                              onClick={() => void reorder("field", f.id, group.fields[fi + 1]!.id)}>
                              <ChevronDown aria-hidden />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Delete ${f.label}`}
                              disabled={busy}
                              onClick={() => void deleteField(f.id)}
                            >
                              <Trash2 aria-hidden />
                            </Button>
                          </div>
                          {f.type === FieldType.Choice && (
                            <div className="pt-2">
                              <OptionsEditor
                                options={f.options}
                                onChange={(next) => void patchField(f.id, { options: next })}
                              />
                            </div>
                          )}
                        </div>
                      ))}
                      <AddField groupId={group.id} onAdd={addField} busy={busy} />
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => setAddGroupOpen(true)}>
                    Add group
                  </Button>
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => void clear()}>
                    Clear all fields
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <AddGroupDialog open={addGroupOpen} onOpenChange={setAddGroupOpen} onAdd={addGroup} busy={busy} />
    </div>
  );
}

function AddField({
  groupId,
  onAdd,
  busy,
}: {
  groupId: string;
  onAdd: (groupId: string, label: string, type: string) => Promise<void>;
  busy: boolean;
}) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<string>(FieldType.Text);
  const submit = () => {
    const v = label.trim();
    if (v) void onAdd(groupId, v, type).then(() => setLabel(""));
  };
  return (
    <div className="flex items-center gap-2 pt-1">
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Add field…"
        className="h-8 flex-1"
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      <Select value={type} onValueChange={setType}>
        <SelectTrigger size="sm" className="w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {Object.values(FieldType).map((t) => (
              <SelectItem key={t} value={t}>
                {typeLabel(t)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" disabled={busy || !label.trim()} onClick={submit}>
        Add
      </Button>
    </div>
  );
}

function OptionsEditor({ options, onChange }: { options: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState("");
  function commit() {
    const v = draft.trim();
    if (v && !options.includes(v)) onChange([...options, v]);
    setDraft("");
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 transition-colors focus-within:border-ring">
      {options.map((o) => (
        <span
          key={o}
          className="inline-flex items-center gap-0.5 rounded-full bg-muted py-0.5 pr-1 pl-2 text-xs text-foreground"
        >
          {o}
          <button
            type="button"
            aria-label={`Remove ${o}`}
            onClick={() => onChange(options.filter((x) => x !== o))}
            className="rounded-full text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={options.length ? "Add…" : "Add an option…"}
        className="h-5 min-w-20 flex-1 border-0 bg-transparent px-1 text-xs outline-none placeholder:text-muted-foreground"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && !draft && options.length) {
            onChange(options.slice(0, -1));
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}

function AddGroupDialog({
  open,
  onOpenChange,
  onAdd,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (label: string) => Promise<void>;
  busy: boolean;
}) {
  const [label, setLabel] = useState("");
  async function submit() {
    const v = label.trim();
    if (!v) return;
    await onAdd(v);
    setLabel("");
    onOpenChange(false);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setLabel("");
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New group</DialogTitle>
          <DialogDescription>Groups organize fields in the Info tab.</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Group name"
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !label.trim()}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
