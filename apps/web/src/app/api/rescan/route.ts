import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { ROOT } from "@/lib/paths";

export const runtime = "nodejs";

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
