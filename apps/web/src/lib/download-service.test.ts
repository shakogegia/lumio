import { describe, expect, it } from "vitest";
import {
  attachmentDisposition,
  dedupeEntryName,
  sanitizeZipName,
} from "./download-service.js";

describe("dedupeEntryName", () => {
  it("returns the basename unchanged the first time", () => {
    const used = new Set<string>();
    expect(dedupeEntryName("a.jpg", used)).toBe("a.jpg");
    expect(used.has("a.jpg")).toBe(true);
  });

  it("suffixes collisions before the extension", () => {
    const used = new Set<string>();
    expect(dedupeEntryName("a.jpg", used)).toBe("a.jpg");
    expect(dedupeEntryName("a.jpg", used)).toBe("a (2).jpg");
    expect(dedupeEntryName("a.jpg", used)).toBe("a (3).jpg");
  });

  it("handles names without an extension", () => {
    const used = new Set<string>();
    expect(dedupeEntryName("README", used)).toBe("README");
    expect(dedupeEntryName("README", used)).toBe("README (2)");
  });
});

describe("sanitizeZipName", () => {
  it("keeps a clean name", () => {
    expect(sanitizeZipName("My Album")).toBe("My Album");
  });

  it("replaces path separators with dashes", () => {
    expect(sanitizeZipName("a/b\\c")).toBe("a-b-c");
  });

  it("strips reserved characters", () => {
    expect(sanitizeZipName('bad:"<>|?*name')).toBe("badname");
  });

  it("falls back to 'album' when empty or blank", () => {
    expect(sanitizeZipName("   ")).toBe("album");
    expect(sanitizeZipName("")).toBe("album");
  });
});

describe("attachmentDisposition", () => {
  it("builds an ascii filename plus a UTF-8 filename* parameter", () => {
    expect(attachmentDisposition("a.jpg")).toBe(
      "attachment; filename=\"a.jpg\"; filename*=UTF-8''a.jpg",
    );
  });

  it("downgrades non-ascii in the fallback and percent-encodes filename*", () => {
    const value = attachmentDisposition("café.jpg");
    expect(value).toContain('filename="caf_.jpg"');
    expect(value).toContain("filename*=UTF-8''caf%C3%A9.jpg");
  });
});
