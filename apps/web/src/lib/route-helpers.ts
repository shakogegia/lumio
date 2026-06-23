import { NextResponse } from "next/server";
import type { z } from "zod";
import { FeatureScopeError, UnknownFeatureError } from "@lumio/db";
import { AlbumNotFoundError, PhotoNotInAlbumError, SmartAlbumMutationError } from "@/lib/albums-service";
import { FolderCycleError, FolderNotFoundError } from "@/lib/folders-service";

/** The single error-response shape for every API route. */
export interface ApiError {
  error: string;
  details?: unknown;
}

/** Build a JSON error response with the standard shape. */
export function errorJson(message: string, status: number, details?: unknown): NextResponse<ApiError> {
  return NextResponse.json(
    details === undefined ? { error: message } : { error: message, details },
    { status },
  );
}

/** Either the parsed data, or a ready-to-return 400 response. */
export type ParseResult<T> = { data: T } | { response: NextResponse<ApiError> };

/** Parse + validate a JSON request body. Never throws on malformed JSON (→ 400). */
export async function parseJson<T>(request: Request, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<ParseResult<T>> {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { response: errorJson("Invalid request body", 400, parsed.error.flatten()) };
  return { data: parsed.data };
}

/** Parse + validate the query string (flat params). For repeated params, parse manually. */
export function parseQuery<T>(request: Request, schema: z.ZodType<T, z.ZodTypeDef, unknown>): ParseResult<T> {
  const params = new URL(request.url).searchParams;
  const parsed = schema.safeParse(Object.fromEntries(params));
  if (!parsed.success) return { response: errorJson("Invalid query parameters", 400, parsed.error.flatten()) };
  return { data: parsed.data };
}

// The typed domain errors a service may throw, and the HTTP status each maps to.
const ERROR_STATUS: ReadonlyArray<readonly [abstract new (...args: never[]) => Error, number]> = [
  [AlbumNotFoundError, 404],
  [PhotoNotInAlbumError, 404],
  [FolderNotFoundError, 404],
  [SmartAlbumMutationError, 400],
  [FolderCycleError, 400],
  [FeatureScopeError, 400],
  [UnknownFeatureError, 400],
];

/** Map a thrown service error to a response, or null to signal "rethrow" (unknown). */
export function mapServiceError(err: unknown): NextResponse<ApiError> | null {
  for (const [Cls, status] of ERROR_STATUS) {
    if (err instanceof Cls) return errorJson(err.message || Cls.name, status);
  }
  return null;
}

/** A binary (image) response with immutable caching and an optional download filename. */
export function binaryResponse(
  file: Buffer,
  opts: { contentType: string; cacheControl?: string; downloadAs?: string },
): NextResponse {
  const headers: Record<string, string> = {
    "Content-Type": opts.contentType,
    "Cache-Control": opts.cacheControl ?? "public, max-age=31536000, immutable",
  };
  if (opts.downloadAs) headers["Content-Disposition"] = `attachment; filename="${opts.downloadAs}"`;
  return new NextResponse(new Uint8Array(file), { headers });
}
