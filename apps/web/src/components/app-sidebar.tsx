"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Aperture, ArrowLeft, Images, GalleryVerticalEnd, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Images;
  /** match when the pathname starts with one of these segments */
  match: string[];
};

const PRIMARY: NavItem[] = [
  { href: "/photos", label: "Photos", icon: Images, match: ["/photos", "/photo"] },
  { href: "/albums", label: "Albums", icon: GalleryVerticalEnd, match: ["/albums"] },
];

const SECONDARY: NavItem[] = [
  { href: "/settings", label: "Settings", icon: Settings, match: ["/settings"] },
];

function isActive(pathname: string, item: NavItem) {
  return item.match.some(
    (m) => pathname === m || pathname.startsWith(`${m}/`),
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={item.label}
      className={cn(
        "group flex w-14 flex-col items-center gap-1 rounded-2xl py-2.5 transition-colors",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon
        className="h-[26px] w-[26px] transition-transform duration-200 group-active:scale-90"
        strokeWidth={active ? 2.4 : 1.8}
        aria-hidden
      />
      <span
        className={cn(
          "text-[10px] leading-none tracking-wide",
          active ? "font-semibold" : "font-medium",
        )}
      >
        {item.label}
      </span>
    </Link>
  );
}

export function AppSidebar() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const onPhotoDetail = pathname.startsWith("/photo/");

  return (
    <aside className="sticky top-0 z-30 flex h-dvh w-[76px] shrink-0 flex-col items-center border-r border-border bg-background/80 backdrop-blur-sm">
      {/* Brand — becomes a back button on the photo detail page */}
      {onPhotoDetail ? (
        <button
          type="button"
          title="Back"
          onClick={() => router.back()}
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
        <Link
          href="/photos"
          title="Lumio"
          className="mt-5 flex h-11 w-11 items-center justify-center rounded-2xl text-foreground"
        >
          <Aperture
            className="h-7 w-7 transition-transform duration-500 ease-out hover:rotate-90"
            strokeWidth={1.9}
            aria-hidden
          />
          <span className="sr-only">Lumio</span>
        </Link>
      )}

      {/* Primary nav — vertically centered in the rail */}
      <nav className="flex flex-1 flex-col items-center justify-center gap-1">
        {PRIMARY.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(pathname, item)} />
        ))}
      </nav>

      {/* Bottom group */}
      <div className="mb-4 flex flex-col items-center gap-1">
        {SECONDARY.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(pathname, item)} />
        ))}
      </div>
    </aside>
  );
}
