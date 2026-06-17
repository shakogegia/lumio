"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Renders intercepted-route content in the main content area (to the right of
 * the 76px sidebar) so it looks identical to the standalone detail page — but
 * because it arrives via soft navigation, the page underneath stays mounted and
 * its scroll position is preserved when you go back (sidebar back arrow, browser
 * back, or Escape). No backdrop or popup chrome: this is the full-page view.
 *
 * Parallel-route slots keep their last content on soft navigation, so when you
 * navigate away via the sidebar (e.g. to /photos) the @modal slot would still
 * show this overlay on top. We guard on the pathname and render nothing unless
 * we're actually on a /photo/[id] route.
 */
export function RouteOverlay({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const visible = pathname?.startsWith("/photo/") ?? false;

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.back();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible, router]);

  if (!visible) return null;

  return (
    <div className="fixed inset-y-0 left-[76px] right-0 z-40 overflow-y-auto bg-background">
      {children}
    </div>
  );
}
