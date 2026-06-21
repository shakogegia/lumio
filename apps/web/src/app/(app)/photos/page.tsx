import type { Metadata } from "next";
import { LibraryView } from "./library-view";

export const metadata: Metadata = { title: "Photos" };

export default function PhotosPage() {
  return (
    <main className="w-full px-4 pb-6">
      <LibraryView />
    </main>
  );
}
