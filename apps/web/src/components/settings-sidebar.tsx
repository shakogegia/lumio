"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, GalleryVerticalEnd, User, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/settings/account", label: "Account", icon: User },
  { href: "/settings/catalogs", label: "Catalogs", icon: GalleryVerticalEnd },
  { href: "/settings/users", label: "Users", icon: Users },
];

/**
 * Left rail for the settings area. `backHref` is computed server-side (the
 * remembered catalog's photos, or "/") so "Back to photos" returns the user to
 * where they were. Active state matches by path prefix so the Catalogs item
 * stays lit on the per-catalog detail page (`/settings/catalogs/<id>`).
 */
export function SettingsSidebar({ backHref }: { backHref: string }) {
  const pathname = usePathname() ?? "";

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex h-dvh w-60 flex-col border-r border-border bg-background">
      <div className="px-3 pt-5">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to photos
        </Link>
        <h2 className="mt-4 px-2 text-lg font-semibold tracking-tight">Settings</h2>
      </div>

      <nav className="mt-4 flex flex-col gap-0.5 px-3">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              prefetch={false}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                active
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <Icon className="size-[18px]" aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
