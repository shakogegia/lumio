"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, FileClock, GalleryHorizontalEnd, Tags, ToggleRight, User, Users } from "lucide-react";
import { NavLink, isActive, type NavItem } from "@/components/sidebar-nav-link";
import { SettingsWorkerStatus } from "@/components/settings-worker-status";

/**
 * Settings rail. Mirrors the main {@link AppSidebar} look — a narrow 76px
 * icon+label rail using the same {@link NavLink} — but the brand/logo slot is
 * replaced by a back arrow that returns to the photos view (`backHref`, resolved
 * server-side from the remembered catalog, else "/").
 */
export function SettingsSidebar({
  backHref,
  catalogSlug,
  showMetadata,
}: {
  backHref: string;
  /** Default catalog for the global worker poll; null when no catalogs exist. */
  catalogSlug: string | null;
  showMetadata: boolean;
}) {
  const pathname = usePathname() ?? "/";

  const items: NavItem[] = [
    { href: "/settings/account", label: "Account", icon: User, match: ["/settings/account"] },
    { href: "/settings/catalogs", label: "Catalogs", icon: GalleryHorizontalEnd, match: ["/settings/catalogs"] },
    { href: "/settings/features", label: "Features", icon: ToggleRight, match: ["/settings/features"] },
    ...(showMetadata
      ? [{ href: "/settings/metadata", label: "Metadata", icon: Tags, match: ["/settings/metadata"] } as NavItem]
      : []),
    { href: "/settings/logs", label: "Logs", icon: FileClock, match: ["/settings/logs"] },
    { href: "/settings/users", label: "Users", icon: Users, match: ["/settings/users"] },
  ];

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex h-dvh w-[76px] flex-col items-center border-r border-border bg-background/80 backdrop-blur-sm">
      {/* Back arrow takes the brand/logo position from the main sidebar. */}
      <Link
        href={backHref}
        title="Back to photos"
        className="group mt-5 flex h-11 w-11 items-center justify-center rounded-2xl text-foreground transition-colors hover:bg-muted"
      >
        <ArrowLeft
          className="h-7 w-7 transition-transform duration-200 group-hover:-translate-x-0.5"
          strokeWidth={1.9}
          aria-hidden
        />
        <span className="sr-only">Back to photos</span>
      </Link>

      {/* Section nav — vertically centered, same NavLink as the main rail. */}
      <nav className="flex flex-1 flex-col items-center justify-center gap-1">
        {items.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(pathname, item)} />
        ))}
      </nav>

      {/* Footer mirrors the main rail's "More" slot so the nav centers the same
          way; here it carries the live worker-status pill. */}
      <div className="mb-4 flex flex-col items-center gap-1">
        <SettingsWorkerStatus slug={catalogSlug} />
      </div>
    </aside>
  );
}
