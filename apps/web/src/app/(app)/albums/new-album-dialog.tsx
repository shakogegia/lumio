"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type RuleType = "last_30_days" | "camera_eq";

interface RuleRow {
  id: number;
  type: RuleType;
  value: string;
}

let nextId = 1;

function buildRule(row: RuleRow) {
  if (row.type === "last_30_days") {
    return { field: "takenAt", op: "last_30_days" as const };
  }
  return { field: "exif.cameraModel", op: "eq" as const, value: row.value };
}

export function NewAlbumDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [isSmart, setIsSmart] = useState(false);
  const [match, setMatch] = useState<"all" | "any">("all");
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setIsSmart(false);
    setMatch("all");
    setRules([]);
    setError(null);
  }

  function addRule() {
    setRules((prev) => [...prev, { id: nextId++, type: "last_30_days", value: "" }]);
  }

  function removeRule(id: number) {
    setRules((prev) => prev.filter((r) => r.id !== id));
  }

  function updateRuleType(id: number, type: RuleType) {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, type, value: "" } : r)),
    );
  }

  function updateRuleValue(id: number, value: string) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, value } : r)));
  }

  const cameraRulesWithEmptyValue = isSmart
    ? rules.some((r) => r.type === "camera_eq" && r.value.trim() === "")
    : false;

  const disabled =
    pending ||
    name.trim() === "" ||
    (isSmart && rules.length === 0) ||
    cameraRulesWithEmptyValue;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    setPending(true);
    setError(null);
    try {
      const body = isSmart
        ? {
            name: name.trim(),
            isSmart: true,
            rules: {
              match,
              rules: rules.map(buildRule),
            },
          }
        : { name: name.trim(), isSmart: false };

      const res = await fetch("/api/albums", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(
          typeof data?.error === "string" ? data.error : "Failed to create album",
        );
        return;
      }

      setOpen(false);
      reset();
      router.refresh();
    } catch {
      setError("Failed to create album");
    } finally {
      setPending(false);
    }
  }

  function handleOpenChange(value: boolean) {
    setOpen(value);
    if (!value) reset();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>New album</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New album</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="album-name">Name</Label>
            <Input
              id="album-name"
              placeholder="Album name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="flex items-center gap-3">
            <Switch
              id="is-smart"
              checked={isSmart}
              onCheckedChange={(val) => {
                setIsSmart(val);
                if (!val) setRules([]);
              }}
            />
            <Label htmlFor="is-smart">Smart album</Label>
          </div>

          {isSmart && (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <Label htmlFor="match-select">Match</Label>
                <select
                  id="match-select"
                  value={match}
                  onChange={(e) => setMatch(e.target.value as "all" | "any")}
                  className="rounded-md border border-input bg-transparent px-2 py-1 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/50"
                >
                  <option value="all">all</option>
                  <option value="any">any</option>
                </select>
                <span className="text-sm text-muted-foreground">of the following rules</span>
              </div>

              {rules.map((rule) => (
                <div key={rule.id} className="flex items-center gap-2">
                  <select
                    value={rule.type}
                    onChange={(e) => updateRuleType(rule.id, e.target.value as RuleType)}
                    className="rounded-md border border-input bg-transparent px-2 py-1 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/50"
                  >
                    <option value="last_30_days">Taken in the last 30 days</option>
                    <option value="camera_eq">Camera model equals</option>
                  </select>
                  {rule.type === "camera_eq" && (
                    <Input
                      placeholder="Camera model"
                      value={rule.value}
                      onChange={(e) => updateRuleValue(rule.id, e.target.value)}
                      className="flex-1"
                    />
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeRule(rule.id)}
                    aria-label="Remove rule"
                  >
                    ×
                  </Button>
                </div>
              ))}

              <Button type="button" variant="outline" size="sm" onClick={addRule}>
                Add rule
              </Button>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={disabled}>
              {pending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
