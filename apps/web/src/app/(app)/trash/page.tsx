import type { Metadata } from "next";
import { TrashView } from "./trash-view";

export const metadata: Metadata = { title: "Trash" };

export default function TrashPage() {
  return (
    <main className="w-full px-6 pb-6">
      <TrashView />
    </main>
  );
}
