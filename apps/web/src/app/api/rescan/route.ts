import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { ROOT } from "@/lib/paths";
import { requireSession } from "@/lib/server-session";

export const runtime = "nodejs";

export async function POST(): Promise<NextResponse> {
  const guard = await requireSession();
  if (guard.response) return guard.response;

  // Heavy ingestion stays in the worker process (per spec). Fire-and-forget.
  const child = spawn("pnpm", ["--filter", "@lumio/worker", "ingest"], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  return NextResponse.json({ status: "started" }, { status: 202 });
}
