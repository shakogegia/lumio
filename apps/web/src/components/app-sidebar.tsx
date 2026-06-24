"use client";

import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, Heart, Images, GalleryVerticalEnd, ImageUp, KeyRound, Search, FolderSearch } from "lucide-react";
import { FeatureKey } from "@lumio/shared";
import { showPasskeyNudgeToast } from "@/app/(app)/passkey-nudge";
import { FeatureGate } from "@/components/features/features-provider";
import { CatalogSwitcher } from "@/components/catalog-switcher";
import { SidebarMore } from "@/components/sidebar-more";
import { NavLink, isActive, type NavItem } from "@/components/sidebar-nav-link";
import { SidebarAlbums } from "@/components/sidebar-albums";
import { catalogPath } from "@/lib/catalog-api";
import { useCatalog } from "@/components/providers/catalog-context";

// Hrefs/match segments are catalog-relative; the sidebar scopes them to the
// active catalog (`/c/<slug>/…`) at render and strips that prefix before
// matching the active route. Items with a `feature` only render when that
// feature is enabled (gated via <FeatureGate> below).
const PRIMARY: NavItem[] = [
  { href: "/photos", label: "Photos", icon: Images, match: ["/photos", "/photo"] },
  { href: "/search", label: "Search", icon: Search, match: ["/search"] },
  { href: "/albums", label: "Albums", icon: GalleryVerticalEnd, match: ["/albums"] },
  { href: "/folders", label: "Folders", icon: FolderSearch, match: ["/folders"], feature: FeatureKey.DiskExplorer },
  { href: "/favorites", label: "Favorites", icon: Heart, match: ["/favorites"] },
  { href: "/upload", label: "Upload", icon: ImageUp, match: ["/upload"] },
];

export function AppSidebar() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const { slug } = useCatalog();

  // The nav items match against catalog-relative paths, so strip the active
  // catalog's `/c/<slug>` prefix from the current pathname before matching.
  const prefix = `/c/${encodeURIComponent(slug)}`;
  const scopedPath = pathname.startsWith(prefix) ? pathname.slice(prefix.length) || "/" : pathname;
  const onPhotoDetail = scopedPath.startsWith("/photo/");

  // On a soft navigation into the photo overlay there's an in-app history entry
  // to pop, and popping it restores the grid's scroll position. But on a fresh
  // load of the standalone page (refresh or direct link) nothing was pushed, so
  // router.back() has no destination — fall back to the grid explicitly.
  const handleBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(catalogPath(slug, "/photos"));
  };

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex h-dvh w-[76px] flex-col items-center border-r border-border bg-background/80 backdrop-blur-sm">
      {/* Brand logo doubles as the catalog switcher; on the photo detail page it
          becomes a back button instead. */}
      {onPhotoDetail ? (
        <button
          type="button"
          title="Back"
          onClick={handleBack}
          className="group mt-5 flex h-11 w-11 items-center justify-center rounded-2xl text-foreground transition-colors hover:bg-muted"
        >
          <ArrowLeft
            className="h-7 w-7 transition-transform duration-200 group-hover:-translate-x-0.5"
            strokeWidth={1.9}
            aria-hidden
          />
          <span className="sr-only">Back</span>
        </button>
      ) : (
        <CatalogSwitcher />
      )}

      {/* Primary nav — vertically centered in the rail */}
      <nav className="flex flex-1 flex-col items-center justify-center gap-1">
        {/* Albums gets the hover flyout; the others are plain nav links. Each
            item's href is scoped to the active catalog; active state matches
            the catalog-relative pathname. */}
        {PRIMARY.map((item) => {
          const scoped = { ...item, href: catalogPath(slug, item.href) };
          const node =
            item.href === "/albums" ? (
              <SidebarAlbums key={item.href} item={scoped} active={isActive(scopedPath, item)} />
            ) : (
              <NavLink key={item.href} item={scoped} active={isActive(scopedPath, item)} />
            );
          return item.feature ? (
            <FeatureGate key={item.href} feature={item.feature}>
              {node}
            </FeatureGate>
          ) : (
            node
          );
        })}
      </nav>

      {/* Bottom group */}
      <div className="mb-4 flex flex-col items-center gap-1">
        {/* Dev-only: fire the passkey nudge toast on demand for testing. */}
        {process.env.NODE_ENV === "development" && (
          <button
            type="button"
            title="Test passkey toast (dev only)"
            onClick={showPasskeyNudgeToast}
            className="group flex w-14 flex-col items-center gap-1 rounded-2xl py-2.5 text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground"
          >
            <KeyRound
              className="h-[26px] w-[26px] transition-transform duration-200 group-active:scale-90"
              strokeWidth={1.8}
              aria-hidden
            />
            <span className="text-[10px] leading-none font-medium tracking-wide">
              Passkey
            </span>
          </button>
        )}
        <SidebarMore />
      </div>
    </aside>
  );
}
