"use client";

import { useEffect, useState } from "react";
import { Tags } from "lucide-react";
import { toast } from "sonner";
import { FeatureKey, FieldType, type MetadataSchema } from "@lumio/shared";
import { useFeature } from "@/components/features/features-provider";
import { useCatalog } from "@/components/providers/catalog-context";
import { catalogApiUrl } from "@/lib/catalog-api";
import { postJson } from "@/lib/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function BulkMetadataButton({
  selectedIds,
  disabled,
  onApplied,
}: {
  selectedIds: Set<string>;
  disabled?: boolean;
  onApplied: () => void;
}) {
  const enabled = useFeature(FeatureKey.Metadata);
  const [open, setOpen] = useState(false);
  if (!enabled) return null;
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon-sm" disabled={disabled} onClick={() => setOpen(true)} aria-label="Edit metadata">
            <Tags aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Edit metadata</TooltipContent>
      </Tooltip>
      {open && (
        <BulkMetadataDialog
          ids={[...selectedIds]}
          onClose={() => setOpen(false)}
          onApplied={() => { setOpen(false); onApplied(); }}
        />
      )}
    </>
  );
}

function BulkMetadataDialog({ ids, onClose, onApplied }: { ids: string[]; onClose: () => void; onApplied: () => void }) {
  const { slug } = useCatalog();
  const [schema, setSchema] = useState<MetadataSchema | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(catalogApiUrl(slug, "/metadata/schema"))
      .then((r) => (r.ok ? r.json() : { schema: [] }))
      .then((d: { schema: MetadataSchema }) => alive && setSchema(d.schema))
      .catch(() => alive && setSchema([]));
    return () => { alive = false; };
  }, [slug]);

  const fields = (schema ?? []).flatMap((g) => g.fields);
  const filled = Object.entries(values).filter(([, v]) => v.trim() !== "");

  async function apply() {
    setBusy(true);
    try {
      await postJson(catalogApiUrl(slug, "/metadata/bulk"), {
        photoIds: ids,
        values: filled.map(([fieldId, value]) => ({ fieldId, value })),
      });
      toast.success(`Updated ${ids.length} photo${ids.length === 1 ? "" : "s"}`);
      onApplied();
    } catch {
      toast.error("Couldn't update metadata.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit metadata · {ids.length} photo{ids.length === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>Only the fields you fill are applied; the rest stay untouched.</DialogDescription>
        </DialogHeader>

        {schema === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : fields.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No custom fields. Add some in Settings → Metadata.
          </p>
        ) : (
          <div className="space-y-4">
            {(schema ?? []).filter((g) => g.fields.length > 0).map((group) => (
              <div key={group.id} className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
                {group.fields.map((f) => (
                  <div key={f.id} className="flex items-center justify-between gap-3">
                    <span className="shrink-0 text-sm text-muted-foreground">{f.label}</span>
                    <BulkInput
                      field={f}
                      value={values[f.id] ?? ""}
                      onChange={(v) => setValues((s) => ({ ...s, [f.id]: v }))}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void apply()} disabled={busy || filled.length === 0}>
            Apply to {ids.length}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type FieldDef = MetadataSchema[number]["fields"][number];

function BulkInput({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: string;
  onChange: (v: string) => void;
}) {
  if (field.type === FieldType.Choice && field.options.length > 0) {
    return (
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger size="sm" className="w-44"><SelectValue placeholder="—" /></SelectTrigger>
        <SelectContent>
          {field.options.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
        </SelectContent>
      </Select>
    );
  }
  if (field.type === FieldType.Textarea) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="w-44 resize-none rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:border-ring"
      />
    );
  }
  return (
    <Input
      type={field.type === FieldType.Number ? "number" : field.type === FieldType.Date ? "date" : "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-44"
    />
  );
}
