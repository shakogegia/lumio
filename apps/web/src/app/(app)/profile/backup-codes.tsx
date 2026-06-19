"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Renders one-time backup codes with copy + download. Codes are shown only at
 * enrollment / regeneration time (Better Auth returns them then); they are not
 * retrievable later, so the UI nudges the user to save them.
 */
export function BackupCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable or permission denied — leave the button labeled
      // "Copy" so the failure is visible. Download remains as a fallback.
    }
  }

  function download() {
    const blob = new Blob([codes.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lumio-backup-codes.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3 rounded-lg bg-muted p-4">
      <p className="text-sm font-medium">Save your backup codes</p>
      <p className="text-xs text-muted-foreground">
        Each code works once if you lose access to your authenticator app. Store
        them somewhere safe — they won’t be shown again.
      </p>
      <ul aria-label="Backup codes" className="grid grid-cols-2 gap-1 font-mono text-sm">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={copy}
          aria-label={copied ? "Copied to clipboard" : "Copy backup codes to clipboard"}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={download}>
          Download
        </Button>
      </div>
    </div>
  );
}
