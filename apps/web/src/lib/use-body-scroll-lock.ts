// apps/web/src/lib/use-body-scroll-lock.ts
import { useEffect } from "react";

/**
 * Pin the body in place while `active`, freezing the window scroll without
 * losing position (the grid uses a window virtualizer, so plain overflow:hidden
 * on the root is unreliable). Pads the locked element by the scrollbar width so
 * centered content doesn't shift on scrollbar removal. Lifted from RouteOverlay.
 */
export function useBodyScrollLock(active: boolean, padRef?: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return;
    const { body } = document;
    const scrollY = window.scrollY;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
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
    const padEl = padRef?.current;
    // eslint-disable-next-line react-hooks/immutability -- padRef is a ref arg; mutating .current's DOM style is the hook's purpose. (RouteOverlay did the same via a local useRef, which the rule doesn't flag.)
    if (scrollbarWidth > 0 && padEl) padEl.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      window.scrollTo(0, scrollY);
      if (padEl) padEl.style.paddingRight = "";
    };
  }, [active, padRef]);
}
