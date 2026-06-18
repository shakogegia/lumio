"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_UPLOAD_TEMPLATE,
  renderTemplate,
  validateTemplate,
} from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PREVIEW_DATE = new Date("2026-06-18T00:00:00.000Z");

export function UploadTemplateForm({ initial }: { initial: string }) {
  const router = useRouter();
  const [template, setTemplate] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const validation = validateTemplate(template);
  const preview = validation.ok
    ? renderTemplate(template, { date: PREVIEW_DATE, originalFilename: "IMG_1234.jpg" })
    : null;

  async function save() {
    setState("saving");
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadTemplate: template }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState("saved");
      router.refresh();
      setTimeout(() => setState("idle"), 1500);
    } catch {
      setState("error");
    }
  }

  return (
    <Card className="space-y-4 p-4">
      <div className="space-y-1">
        <Label htmlFor="uploadTemplate">Upload folder template</Label>
        <Input
          id="uploadTemplate"
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          className="font-mono"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Tokens: <code>{"{YYYY}"}</code> <code>{"{MM}"}</code> <code>{"{DD}"}</code>{" "}
        <code>{"{filename}"}</code> <code>{"{ext}"}</code>. Default:{" "}
        <code>{DEFAULT_UPLOAD_TEMPLATE}</code>.
      </p>

      {validation.ok ? (
        <p className="text-sm">
          <span className="text-muted-foreground">Example: </span>
          <span className="font-mono">{preview}</span>
        </p>
      ) : (
        <p className="text-sm text-destructive">{validation.error}</p>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={!validation.ok || state === "saving"}>
          {state === "saving" ? "Saving…" : "Save"}
        </Button>
        {state === "saved" && <span className="text-sm text-muted-foreground">Saved</span>}
        {state === "error" && <span className="text-sm text-destructive">Save failed</span>}
      </div>
    </Card>
  );
}
