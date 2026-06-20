"use client";

import Link from "next/link";
import { Images } from "lucide-react";
import { cn } from "@/lib/utils";

export type NavItem = {
  href: string;
  label: string;
  icon: typeof Images;
  /** match when the pathname starts with one of these segments */
  match: string[];
};

export function isActive(pathname: string, item: NavItem) {
  return item.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
}

type NavLinkProps = Omit<React.ComponentProps<typeof Link>, "href"> & {
  item: NavItem;
  active: boolean;
};

// `...props` + spread onto <Link> lets this be used as a Radix `asChild`
// trigger: Slot injects hover/focus handlers and a ref, which flow through to
// the underlying anchor.
export function NavLink({ item, active, className, ...props }: NavLinkProps) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      title={item.label}
      className={cn(
        "group flex w-14 flex-col items-center gap-1 rounded-2xl py-2.5 transition-colors",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
      {...props}
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
