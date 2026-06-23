"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_UPLOAD_TEMPLATE,
  renderTemplate,
  validateTemplate,
} from "@lumio/shared";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { catalogApiUrl } from "@/lib/catalog-api";
import { postJson } from "@/lib/http";
import { useCatalog } from "@/components/providers/catalog-context";

const PREVIEW_DATE = new Date("2026-06-18T00:00:00.000Z");

export function UploadTemplateForm({ initial }: { initial: string }) {
  const router = useRouter();
  const { slug } = useCatalog();
  const [template, setTemplate] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const validation = validateTemplate(template);
  const preview = validation.ok
    ? renderTemplate(template, { date: PREVIEW_DATE, originalFilename: "IMG_1234.jpg" })
    : null;

  async function save() {
    setState("saving");
    try {
      await postJson(catalogApiUrl(slug, "/settings"), { uploadTemplate: template }, "PUT");
      setState("saved");
      router.refresh();
      setTimeout(() => setState("idle"), 1500);
    } catch {
      setState("error");
    }
  }

  return (
    <div className="space-y-6">
      <Field>
        <FieldLabel htmlFor="uploadTemplate">Upload folder template</FieldLabel>
        <Input
          id="uploadTemplate"
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          className="font-mono"
          aria-invalid={!validation.ok}
        />
        <FieldDescription>
          Tokens: <code>{"{YYYY}"}</code> <code>{"{MM}"}</code> <code>{"{DD}"}</code>{" "}
          <code>{"{filename}"}</code> <code>{"{ext}"}</code>.
        </FieldDescription>
        <FieldDescription>
          Default: <code>{DEFAULT_UPLOAD_TEMPLATE}</code>
        </FieldDescription>
        {validation.ok ? (
          <FieldDescription>
            Example: <span className="font-mono text-foreground">{preview}</span>
          </FieldDescription>
        ) : (
          <FieldError>{validation.error}</FieldError>
        )}
      </Field>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={!validation.ok || state === "saving"}>
          {state === "saving" ? "Saving…" : "Save"}
        </Button>
        {state === "saved" && <span className="text-sm text-muted-foreground">Saved</span>}
        {state === "error" && <span className="text-sm text-destructive">Save failed</span>}
      </div>
    </div>
  );
}
