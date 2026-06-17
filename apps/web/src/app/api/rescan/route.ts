import { spawn } from "node:child_process";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Next runs from apps/web; the monorepo root is two levels up.
const ROOT = path.resolve(process.cwd(), "..", "..");

export async function POST(): Promise<NextResponse> {
  // Heavy ingestion stays in the worker process (per spec). Fire-and-forget.
  const child = spawn("pnpm", ["--filter", "@lumio/worker", "ingest"], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  return NextResponse.json({ status: "started" }, { status: 202 });
}
