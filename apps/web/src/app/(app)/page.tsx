import { redirect } from "next/navigation";
import { getDefaultCatalogSlug } from "@/lib/server/active-catalog";

export default async function Home() {
  const slug = await getDefaultCatalogSlug();
  if (!slug) redirect("/setup"); // no catalog yet → setup (Phase 4 wires the catalog step)
  redirect(`/c/${slug}/photos`);
}
