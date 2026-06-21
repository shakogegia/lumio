import type { Metadata } from "next";
import { FavoritesView } from "./favorites-view";

export const metadata: Metadata = { title: "Favorites" };

export default function FavoritesPage() {
  return (
    <main className="w-full px-4 pb-6">
      <FavoritesView />
    </main>
  );
}
