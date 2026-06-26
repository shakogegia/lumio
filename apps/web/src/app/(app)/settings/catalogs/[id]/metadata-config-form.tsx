"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FeatureKey, FieldType, type MetadataSchema } from "@lumio/shared";
import { postJson } from "@/lib/http";
import { apiPaths } from "@/lib/api-paths";
import { catalogApiUrl } from "@/lib/catalog-api";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { GripVertical, Trash2, X } from "lucide-react";
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
  const [local, setLocal] = useState(schema);
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setLocal(schema);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [schema]);
  const [drag, setDrag] = useState<{ kind: "group" | "field"; id: string; groupId?: string } | null>(null);

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

  function onGroupDragOver(targetId: string) {
    if (drag?.kind !== "group" || drag.id === targetId) return;
    setLocal((cur) => {
      const ids = cur.map((g) => g.id);
      const from = ids.indexOf(drag.id);
      const to = ids.indexOf(targetId);
      if (from === -1 || to === -1) return cur;
      const next = [...cur];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  }
  function onGroupDrop() {
    if (drag?.kind !== "group") return;
    const idx = local.findIndex((g) => g.id === drag.id);
    const afterId = idx > 0 ? local[idx - 1]!.id : null;
    setDrag(null);
    void reorder("group", drag.id, afterId);
  }

  function onFieldDragOver(groupId: string, targetId: string) {
    if (drag?.kind !== "field" || drag.groupId !== groupId || drag.id === targetId) return;
    setLocal((cur) =>
      cur.map((g) => {
        if (g.id !== groupId) return g;
        const ids = g.fields.map((f) => f.id);
        const from = ids.indexOf(drag.id);
        const to = ids.indexOf(targetId);
        if (from === -1 || to === -1) return g;
        const fields = [...g.fields];
        const [moved] = fields.splice(from, 1);
        fields.splice(to, 0, moved!);
        return { ...g, fields };
      }),
    );
  }
  function onFieldDrop(groupId: string) {
    if (drag?.kind !== "field") return;
    const g = local.find((x) => x.id === groupId);
    const idx = g ? g.fields.findIndex((f) => f.id === drag.id) : -1;
    const afterId = idx > 0 ? g!.fields[idx - 1]!.id : null;
    setDrag(null);
    void reorder("field", drag.id, afterId);
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
                : "Start from the film preset, or add your own group."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {!hasGroups ? (
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => void applyPreset()}>
                  Apply film preset
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => setAddGroupOpen(true)}>
                  Add group
                </Button>
              </div>
            ) : (
              <>
                {local.map((group) => (
                  <div
                    key={group.id}
                    className={cn("space-y-2", drag?.kind === "group" && drag.id === group.id && "opacity-50")}
                    draggable
                    onDragStart={() => setDrag({ kind: "group", id: group.id })}
                    onDragOver={(e) => { e.preventDefault(); onGroupDragOver(group.id); }}
                    onDragEnd={onGroupDrop}
                  >
                    <div className="flex items-center gap-2">
                      <span className="cursor-grab text-muted-foreground/60 active:cursor-grabbing">
                        <GripVertical className="size-4" aria-hidden />
                      </span>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
                    </div>
                    <div className="space-y-1.5">
                      {group.fields.map((f) => (
                        <div
                          key={f.id}
                          className={cn("rounded-lg border bg-card px-3 py-2", drag?.kind === "field" && drag.id === f.id && "opacity-50")}
                          draggable
                          onDragStart={(e) => { e.stopPropagation(); setDrag({ kind: "field", id: f.id, groupId: group.id }); }}
                          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); onFieldDragOver(group.id, f.id); }}
                          onDragEnd={(e) => { e.stopPropagation(); onFieldDrop(group.id); }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="cursor-grab text-muted-foreground/60 active:cursor-grabbing">
                              <GripVertical className="size-4" aria-hidden />
                            </span>
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
