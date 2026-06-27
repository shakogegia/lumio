"use client";

import { Fragment, useState } from "react";
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
const PREVIEW_NOW = new Date("2026-06-27T00:00:00.000Z");

const TOKEN_GROUPS: ReadonlyArray<{
  label: string;
  hint: string;
  tokens: ReadonlyArray<{ token: string; desc: string; example: string }>;
}> = [
  {
    label: "Taken-at date",
    hint: "when the photo was captured",
    tokens: [
      { token: "{TAKEN_YYYY}", desc: "Year", example: "2026" },
      { token: "{TAKEN_MM}", desc: "Month", example: "06" },
      { token: "{TAKEN_DD}", desc: "Day", example: "18" },
    ],
  },
  {
    label: "Current date",
    hint: "when the file is uploaded",
    tokens: [
      { token: "{NOW_YYYY}", desc: "Year", example: "2026" },
      { token: "{NOW_MM}", desc: "Month", example: "06" },
      { token: "{NOW_DD}", desc: "Day", example: "27" },
    ],
  },
  {
    label: "File",
    hint: "from the uploaded file",
    tokens: [
      { token: "{filename}", desc: "Original file name", example: "IMG_1234.jpg" },
      { token: "{ext}", desc: "Extension, no dot", example: "jpg" },
    ],
  },
];

export function UploadTemplateForm({ initial }: { initial: string }) {
  const router = useRouter();
  const { slug } = useCatalog();
  const [template, setTemplate] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const validation = validateTemplate(template);
  const preview = validation.ok
    ? renderTemplate(template, {
        date: PREVIEW_DATE,
        now: PREVIEW_NOW,
        originalFilename: "IMG_1234.jpg",
      })
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
        <div className="rounded-lg border bg-muted/40 p-3 text-xs">
          <p className="mb-2.5 font-medium text-muted-foreground">Available tokens</p>
          <div className="space-y-3">
            {TOKEN_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="mb-1.5">
                  <span className="font-medium text-foreground">{group.label}</span>
                  <span className="text-muted-foreground"> — {group.hint}</span>
                </p>
                <div className="grid grid-cols-[minmax(7rem,auto)_1fr_auto] items-center gap-x-4 gap-y-1">
                  {group.tokens.map((t) => (
                    <Fragment key={t.token}>
                      <code className="font-mono text-foreground">{t.token}</code>
                      <span className="text-muted-foreground">{t.desc}</span>
                      <span className="justify-self-end font-mono tabular-nums text-muted-foreground">
                        {t.example}
                      </span>
                    </Fragment>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
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
