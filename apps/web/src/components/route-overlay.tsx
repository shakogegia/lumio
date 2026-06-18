"use client";

import { useEffect, useRef } from "react";
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
  const overlayRef = useRef<HTMLDivElement>(null);
  const visible = pathname?.startsWith("/photo/") ?? false;

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.back();
    };
    document.addEventListener("keydown", onKey);

    // The page underneath stays mounted on soft navigation, and the photo grid
    // scrolls the window (it uses a window virtualizer). Left alone, that list
    // scrolls and shows its scrollbar behind this overlay. Lock it by pinning
    // the body: offsetting it by the current scroll freezes the page in place
    // without losing position (`overflow: hidden` on the root is unreliable
    // here — the html element is the scroll container). The sidebar and this
    // overlay are fixed to the viewport, so pinning the body never moves them.
    const { body } = document;
    const scrollY = window.scrollY;
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    // Pinning the body removes the window scrollbar; where scrollbars take
    // layout space that widens the viewport, so pad the overlay's right edge to
    // keep its centered content from shifting. A no-op for overlay scrollbars
    // (0 width), e.g. macOS.
    const overlay = overlayRef.current;
    if (scrollbarWidth > 0 && overlay) {
      overlay.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      document.removeEventListener("keydown", onKey);
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      window.scrollTo(0, scrollY);
      if (overlay) overlay.style.paddingRight = "";
    };
  }, [visible, router]);

  if (!visible) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-y-0 left-[76px] right-0 z-40 overflow-y-auto bg-background"
    >
      {children}
    </div>
  );
}
