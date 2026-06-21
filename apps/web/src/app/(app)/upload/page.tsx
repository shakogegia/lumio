import type { Metadata } from "next";
import { UploadClient } from "./upload-client";

export const metadata: Metadata = { title: "Upload" };

export default function UploadPage() {
  return (
    <main className="w-full px-4 pb-6">
      <UploadClient />
    </main>
  );
}
