"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { PhotoGrid } from "../photos/photo-grid";
import { SearchInput } from "./search-input";
import { SearchEmpty } from "./search-empty";
import { type SearchFilters, paramsFor, serialize } from "./filters";

export function SearchView() {
  const [submitted, setSubmitted] = useState<SearchFilters | null>(null);
  const searched = submitted !== null;

  return (
    <div className="relative">
      {/* Search box: centered in the hero, then pinned at the top after a search.
          -mx-6/px-6 + bg-background mirror HeaderBar so it spans full width and
          content scrolls cleanly beneath it once pinned. */}
      <div
        className={cn(
          "sticky top-0 z-20 -mx-6 bg-background px-6 transition-transform duration-500 ease-out",
          searched ? "translate-y-0 py-4" : "translate-y-[35vh] py-0",
        )}
      >
        <div className="mx-auto w-full max-w-2xl">
          <div
            className={cn(
              "overflow-hidden text-center transition-all duration-300",
              searched ? "max-h-0 opacity-0" : "mb-6 max-h-40 opacity-100",
            )}
          >
            <h1 className="text-3xl font-semibold">Search your photos</h1>
            <p className="mt-2 text-muted-foreground">Type @ to filter by album</p>
          </div>
          <SearchInput hero={!searched} onSubmit={setSubmitted} />
        </div>
      </div>

      {searched && submitted && (
        <div className="animate-in fade-in pt-2 duration-500">
          <PhotoGrid
            key={serialize(submitted)}
            endpoint="/api/search"
            params={paramsFor(submitted)}
            empty={<SearchEmpty />}
          />
        </div>
      )}
    </div>
  );
}
