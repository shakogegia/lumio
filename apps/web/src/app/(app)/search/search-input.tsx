"use client";

import { useEffect, useRef } from "react";
import type Tribute from "tributejs";
import { cn } from "@/lib/utils";
import { fieldClassName } from "@/lib/field-style";
import { type TributeFacetItem, loadAllOptions } from "./facets";
import { type SearchFilters, buildFilters } from "./filters";

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

/** Inline, non-editable tag inserted into the contenteditable when an option is picked. */
function chipHtml(item: TributeFacetItem): string {
  const facet = escapeHtml(item.facetKey);
  const value = escapeHtml(item.value);
  const prefix = escapeHtml(item.facetLabel);
  const label = escapeHtml(item.label);
  return (
    `<span contenteditable="false" data-facet="${facet}" data-value="${value}" ` +
    `class="mx-0.5 inline-flex items-center gap-1 rounded-full border border-border bg-accent px-2 py-0.5 align-middle text-sm text-accent-foreground">` +
    `<span class="text-muted-foreground">${prefix}:</span>${label}` +
    `<button type="button" data-chip-remove tabindex="-1" class="ml-0.5 leading-none text-muted-foreground hover:text-foreground">×</button>` +
    `</span>&nbsp;`
  );
}

/** Read the editor DOM into structured filters: chip spans → albums, text → q. */
function readEditor(el: HTMLElement): SearchFilters {
  const albums: string[] = [];
  el.querySelectorAll<HTMLElement>('[data-facet="album"]').forEach((chip) => {
    const value = chip.getAttribute("data-value");
    if (value) albums.push(value);
  });

  let rawText = "";
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    // Skip text that lives inside a chip span.
    if (!node.parentElement?.closest("[data-facet]")) rawText += node.textContent ?? "";
    node = walker.nextNode();
  }
  return buildFilters(albums, rawText);
}

export function SearchInput({
  hero,
  onSubmit,
}: {
  hero: boolean;
  onSubmit: (filters: SearchFilters) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const tributeRef = useRef<Tribute<TributeFacetItem> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let tribute: Tribute<TributeFacetItem> | null = null;
    const el = editorRef.current;

    void (async () => {
      const { default: TributeCtor } = await import("tributejs");
      if (cancelled || !el) return;
      tribute = new TributeCtor<TributeFacetItem>({
        trigger: "@",
        allowSpaces: true,
        lookup: "label",
        fillAttr: "label",
        values: (_text, cb) => {
          loadAllOptions()
            .then((opts) => cb(opts))
            .catch(() => cb([]));
        },
        menuItemTemplate: (item) =>
          `<span class="text-muted-foreground">${escapeHtml(item.original.facetLabel)}</span> · ${escapeHtml(item.original.label)}`,
        selectTemplate: (item) => (item ? chipHtml(item.original) : ""),
        noMatchTemplate: () => "",
      });
      tribute.attach(el);
      tributeRef.current = tribute;
    })();

    return () => {
      cancelled = true;
      if (tribute && el) tribute.detach(el);
      tributeRef.current = null;
    };
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter") return;
    // While the Tribute menu is open, Enter selects an option — let it through.
    if (tributeRef.current?.isActive) return;
    e.preventDefault();
    if (editorRef.current) onSubmit(readEditor(editorRef.current));
  }

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const remove = (e.target as HTMLElement).closest("[data-chip-remove]");
    if (!remove) return;
    e.preventDefault();
    const chip = remove.closest("[data-facet]");
    // Drop the trailing space node chipHtml appended, so repeated add/remove
    // doesn't accumulate stray whitespace text nodes.
    const next = chip?.nextSibling;
    if (next && next.nodeType === Node.TEXT_NODE && /^\s*$/.test(next.textContent ?? "")) {
      next.remove();
    }
    chip?.remove();
  }

  return (
    <div
      ref={editorRef}
      role="searchbox"
      aria-label="Search photos"
      contentEditable
      suppressContentEditableWarning
      data-placeholder="Search photos…  (type @ to filter by album)"
      onKeyDown={handleKeyDown}
      onClick={handleClick}
      className={cn(
        fieldClassName,
        "flex h-auto flex-wrap items-center gap-1 transition-all duration-300",
        "before:pointer-events-none before:text-muted-foreground empty:before:content-[attr(data-placeholder)]",
        hero ? "min-h-14 px-5 text-lg" : "min-h-9 text-base md:text-sm",
      )}
    />
  );
}
