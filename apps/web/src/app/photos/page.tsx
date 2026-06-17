import { PhotoGrid } from "./photo-grid";

export default function PhotosPage() {
  return (
    <main className="mx-auto max-w-7xl p-4">
      <h1 className="mb-4 text-2xl font-semibold">Photos</h1>
      <PhotoGrid />
    </main>
  );
}
