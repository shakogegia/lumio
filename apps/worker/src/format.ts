import path from "node:path";

/**
 * Per-photo timing suffix shared by the scan and watch logs, e.g.
 * `2024/IMG.NEF.jxl (.jxl) 418ms`. The extension flags the heavy `.jxl`
 * files at a glance.
 */
export function timedLine(relPath: string, ms: number): string {
  return `${relPath} (${path.extname(relPath).toLowerCase()}) ${Math.round(ms)}ms`;
}
