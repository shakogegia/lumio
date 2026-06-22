"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, GalleryVerticalEnd, User, Users } from "lucide-react";
import { NavLink, isActive, type NavItem } from "@/components/sidebar-nav-link";

// Settings sections — absolute hrefs (not catalog-scoped). Catalogs matches its
// detail pages too (`/settings/catalogs/<id>`) via the prefix check in isActive.
const ITEMS: NavItem[] = [
  { href: "/settings/account", label: "Account", icon: User, match: ["/settings/account"] },
  { href: "/settings/catalogs", label: "Catalogs", icon: GalleryVerticalEnd, match: ["/settings/catalogs"] },
  { href: "/settings/users", label: "Users", icon: Users, match: ["/settings/users"] },
];

/**
 * Settings rail. Mirrors the main {@link AppSidebar} look — a narrow 76px
 * icon+label rail using the same {@link NavLink} — but the brand/logo slot is
 * replaced by a back arrow that returns to the photos view (`backHref`, resolved
 * server-side from the remembered catalog, else "/").
 */
export function SettingsSidebar({ backHref }: { backHref: string }) {
  const pathname = usePathname() ?? "/";

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
        {ITEMS.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(pathname, item)} />
        ))}
      </nav>
    </aside>
  );
}
