import type { Metadata } from "next";
import { SearchView } from "./search-view";

export const metadata: Metadata = { title: "Search" };

export default function SearchPage() {
  return (
    <main className="w-full px-6 pb-6">
      <SearchView />
    </main>
  );
}
