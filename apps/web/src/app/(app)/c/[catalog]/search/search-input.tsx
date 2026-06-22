"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type Tribute from "tributejs";
import { cn } from "@/lib/utils";
import { useCatalog } from "@/lib/catalog-context";
import { type TributeFacetItem, loadAllOptions } from "./facets";
import { type SearchFilters, buildFilters } from "./filters";

const DEBOUNCE_MS = 250;
const PLACEHOLDER = "Search photos…  (type @ to filter by album)";

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
    `class="mx-0.5 inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 align-middle text-sm text-foreground">` +
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

function isEditorEmpty(el: HTMLElement): boolean {
  return el.textContent?.trim() === "" && el.querySelector("[data-facet]") === null;
}

function isChip(node: Node | null): node is HTMLElement {
  return (
    !!node &&
    node.nodeType === Node.ELEMENT_NODE &&
    (node as HTMLElement).hasAttribute("data-facet")
  );
}

/** Whitespace-only text node — the `&nbsp;` glue chipHtml appends after a chip. */
function isGlue(node: Node | null): boolean {
  return !!node && node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() === "";
}

/**
 * The chip adjacent to a collapsed caret in the delete direction, or null.
 * contenteditable won't delete a `contenteditable="false"` chip on its own, so
 * Backspace/Delete next to one is handled manually. Glue nodes are hopped over.
 */
function adjacentChip(range: Range, dir: "back" | "forward"): HTMLElement | null {
  const { startContainer, startOffset } = range;
  let node: Node | null;

  if (startContainer.nodeType === Node.TEXT_NODE) {
    const len = (startContainer.textContent ?? "").length;
    const onlyGlue = isGlue(startContainer);
    if (dir === "back") {
      if (startOffset > 0 && !onlyGlue) return null; // a real char precedes the caret
      node = startContainer.previousSibling;
    } else {
      if (startOffset < len && !onlyGlue) return null;
      node = startContainer.nextSibling;
    }
  } else {
    const kids = startContainer.childNodes;
    node = dir === "back" ? (kids[startOffset - 1] ?? null) : (kids[startOffset] ?? null);
  }

  while (isGlue(node)) node = dir === "back" ? node!.previousSibling : node!.nextSibling;
  return isChip(node) ? node : null;
}

/** Imperative handle so a parent can repopulate the box (e.g. re-run a recent search). */
export interface SearchInputHandle {
  applyFilters: (filters: SearchFilters) => void;
}

/**
 * The search box: a shadcn-styled pill wrapping a contenteditable. The pill is a
 * wrapper (not the editable itself) so the editable can be content-height and
 * stay vertically centered — otherwise the caret floats to the top of a tall box.
 * Emits the parsed filters on change (debounced); focusing it calls `onActivate`.
 */
export function SearchInput({
  ref,
  compact,
  onChange,
  onActivate,
  onCommit,
}: {
  ref?: React.Ref<SearchInputHandle>;
  /** Compact styling once the box has moved to the top (vs. the centered hero). */
  compact: boolean;
  onChange: (filters: SearchFilters) => void;
  onActivate: () => void;
  /** Fired when focus leaves the box, with the settled filters (for recording recents). */
  onCommit?: (filters: SearchFilters) => void;
}) {
  const { slug } = useCatalog();
  const editorRef = useRef<HTMLDivElement>(null);
  const tributeRef = useRef<Tribute<TributeFacetItem> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  // Read the active slug from a ref inside the Tribute callbacks / imperative
  // handle so they bind once without the mount effect re-running on a re-render.
  const slugRef = useRef(slug);
  const [empty, setEmpty] = useState(true);

  // Keep the latest onChange + slug reachable from the debounce timer / Tribute
  // callbacks without re-running the mount effect. Synced in an effect (not render).
  useEffect(() => {
    onChangeRef.current = onChange;
    slugRef.current = slug;
  });

  // Parse the editor and report filters now. Also refreshes the placeholder.
  const emitNow = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    setEmpty(isEditorEmpty(el));
    onChangeRef.current(readEditor(el));
  }, []);

  // Free-text edits search after a short pause; the placeholder updates instantly.
  const emitDebounced = useCallback(() => {
    const el = editorRef.current;
    if (el) setEmpty(isEditorEmpty(el));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(emitNow, DEBOUNCE_MS);
  }, [emitNow]);

  // Let the parent re-run a recent search by repopulating the box from filters.
  useImperativeHandle(
    ref,
    () => ({
      applyFilters(filters: SearchFilters) {
        const el = editorRef.current;
        if (!el) return;
        void loadAllOptions(slugRef.current)
          .catch(() => [] as TributeFacetItem[])
          .then((opts) => {
            const labelFor = (id: string) =>
              opts.find((o) => o.facetKey === "album" && o.value === id)?.label ?? id;
            el.innerHTML = filters.albums
              .map((id) =>
                chipHtml({ facetKey: "album", facetLabel: "Album", value: id, label: labelFor(id) }),
              )
              .join("");
            if (filters.q) el.appendChild(document.createTextNode(filters.q));
            el.focus();
            emitNow();
          });
      },
    }),
    [emitNow],
  );

  useEffect(() => {
    let cancelled = false;
    let tribute: Tribute<TributeFacetItem> | null = null;
    const el = editorRef.current;

    // Picking a facet inserts a chip — search immediately (no debounce).
    const onReplaced = () => emitNow();
    el?.addEventListener("tribute-replaced", onReplaced);

    void (async () => {
      const { default: TributeCtor } = await import("tributejs");
      if (cancelled || !el) return;
      tribute = new TributeCtor<TributeFacetItem>({
        trigger: "@",
        allowSpaces: true,
        lookup: "label",
        fillAttr: "label",
        // chipHtml already ends with one trailing space; suppress Tribute's own
        // default \xA0 suffix so a selected chip isn't followed by two spaces.
        replaceTextSuffix: "",
        values: (_text, cb) => {
          loadAllOptions(slugRef.current)
            .then((opts) => cb(opts))
            .catch((err) => {
              // Non-blocking: show an empty menu this time; loadAllOptions has
              // already cleared its cache so the next trigger retries.
              console.warn("Failed to load search facet options", err);
              cb([]);
            });
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
      el?.removeEventListener("tribute-replaced", onReplaced);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (tribute && el) tribute.detach(el);
      tributeRef.current = null;
    };
  }, [emitNow]);

  function handleInput() {
    // Typing the "@" trigger (and the query after it) is for the Tribute menu,
    // not a search — don't fire while the menu is open. Picking an option fires
    // the search via the tribute-replaced listener instead.
    if (tributeRef.current?.isActive) {
      const el = editorRef.current;
      if (el) setEmpty(isEditorEmpty(el));
      return;
    }
    emitDebounced();
  }

  function handleBlur() {
    // Skip transient blurs to the open Tribute menu; only commit a settled query.
    if (tributeRef.current?.isActive) return;
    const el = editorRef.current;
    if (el) onCommit?.(readEditor(el));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter") {
      // Never insert a newline; the Tribute menu handles Enter itself when open.
      if (tributeRef.current?.isActive) return;
      e.preventDefault();
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      const editor = editorRef.current;
      const sel = window.getSelection();
      if (!editor || !sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);

      if (!sel.isCollapsed) {
        // contenteditable won't reliably delete a selection spanning non-editable
        // chips (e.g. Cmd/Ctrl+A then Delete). Remove the selected chips ourselves,
        // then delete the rest of the range.
        e.preventDefault();
        const selectedChips = Array.from(
          editor.querySelectorAll<HTMLElement>("[data-facet]"),
        ).filter((chip) => range.intersectsNode(chip));
        range.deleteContents();
        selectedChips.forEach((chip) => chip.remove()); // remove any that survived
        emitNow();
        return;
      }

      // Collapsed caret next to a chip: delete the chip (and its trailing glue).
      const chip = adjacentChip(range, e.key === "Backspace" ? "back" : "forward");
      if (chip) {
        e.preventDefault();
        if (isGlue(chip.nextSibling)) chip.nextSibling!.remove();
        chip.remove();
        emitNow();
      }
    }
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
    emitNow();
  }

  return (
    <div
      className={cn(
        // Mirrors the shadcn input pill, but as a wrapper (focus-within ring)
        // so the inner editable is content-height and the caret stays centered.
        "relative flex w-full items-center rounded-4xl border border-input bg-input/30 py-1.5 text-base transition-all duration-300",
        "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        compact ? "min-h-10 px-4 md:text-sm" : "min-h-14 px-5 text-base",
      )}
      onMouseDown={(e) => {
        // Clicking the padding (not a chip or text) focuses the editable.
        if (e.target === e.currentTarget) {
          e.preventDefault();
          editorRef.current?.focus();
        }
      }}
    >
      {empty && (
        <span
          className={cn(
            "pointer-events-none absolute inset-0 flex items-center truncate text-muted-foreground select-none",
            compact ? "px-4" : "px-5",
          )}
        >
          {PLACEHOLDER}
        </span>
      )}
      <div
        ref={editorRef}
        role="searchbox"
        aria-label="Search photos"
        contentEditable
        suppressContentEditableWarning
        onFocus={onActivate}
        onInput={handleInput}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        // self-stretch fills the wrapper height so a click anywhere in the box
        // lands on the editable (an empty contenteditable is otherwise 0-height);
        // items-center keeps the caret/content vertically centered.
        className="flex w-full flex-1 flex-wrap items-center gap-1 self-stretch outline-none"
      />
    </div>
  );
}
