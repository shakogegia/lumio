import { UploadClient } from "./upload-client";

export default function UploadPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4">
      <h1 className="text-2xl font-semibold">Upload</h1>
      <UploadClient />
    </main>
  );
}
