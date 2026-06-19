// Press-and-hold arrow-key navigation between photos.
//
// The photo detail page lives behind an intercepted/parallel route
// (`@modal/(.)photo/[id]`), so navigating to the next photo REMOUNTS the whole
// subtree — any hold state kept inside the React component is destroyed on the
// very first step. We also can't lean on the browser's native key auto-repeat:
// a navigation moves focus, which cancels the OS repeat, so a held key would
// fire exactly once and then stall. (Both were the cause of the original bug:
// holding an arrow only ever advanced one photo.)
//
// So the hold loop is owned by a single module-level controller that outlives
// every remount. The remounting component just keeps it pointed at the photo
// currently on screen via `setHoldNavTarget`.

/** Cadence for press-and-hold stepping (~7 photos/second). */
export const HOLD_STEP_MS = 140;

export type HoldDirection = "prev" | "next";

export type HoldTarget = {
  prevHref: string | null;
  nextHref: string | null;
  /** Perform the navigation (router.push/replace with `scroll: false`, etc.). */
  navigate: (href: string) => void;
};

export type HoldStepperOptions = {
  /** Latest target, or null when nothing is navigable (e.g. modal closed). */
  getTarget: () => HoldTarget | null;
  /**
   * Start invoking `fn` at the hold cadence and return a cancel function.
   * Injected (rather than calling setInterval directly) so the state machine
   * stays DOM-free and can be driven deterministically in tests.
   */
  schedule: (fn: () => void) => () => void;
};

export type HoldStepper = {
  press: (dir: HoldDirection) => void;
  release: (dir: HoldDirection) => void;
  stop: () => void;
  held: () => HoldDirection | null;
};

/**
 * Press-and-hold navigation state machine — framework- and DOM-free so it can
 * be unit-tested. `press` steps once immediately, then keeps stepping on the
 * injected schedule until the matching `release` (or `stop`). Each step reads
 * the *current* target, so it keeps advancing correctly even though every
 * navigation swaps the target out from under it.
 */
export function createHoldStepper({
  getTarget,
  schedule,
}: HoldStepperOptions): HoldStepper {
  let dir: HoldDirection | null = null;
  let cancel: (() => void) | null = null;
  // The href of the last navigation we kicked off. While the page is busy
  // remounting with the next photo's neighbours the target still points at the
  // old photo, so without this guard a fast tick would re-fire the same nav.
  let lastHref: string | null = null;

  const step = () => {
    if (!dir) return;
    const target = getTarget();
    if (!target) return;
    const href = dir === "prev" ? target.prevHref : target.nextHref;
    // At an end, or the previous step hasn't landed yet. Wait, don't re-fire.
    if (!href || href === lastHref) return;
    lastHref = href;
    target.navigate(href);
  };

  const stop = () => {
    dir = null;
    lastHref = null;
    if (cancel) {
      cancel();
      cancel = null;
    }
  };

  return {
    press(next) {
      if (dir === next) return; // already holding this direction
      dir = next;
      lastHref = null;
      step();
      if (cancel) cancel();
      cancel = schedule(step);
    },
    release(which) {
      if (dir === which) stop();
    },
    stop,
    held: () => dir,
  };
}

// ---------------------------------------------------------------------------
// DOM adapter: a lazily-wired module singleton. Set up once on first use and
// kept for the page's lifetime; it no-ops whenever no target is registered.

let target: HoldTarget | null = null;
let stepper: HoldStepper | null = null;

function directionForKey(key: string): HoldDirection | null {
  if (key === "ArrowLeft") return "prev";
  if (key === "ArrowRight") return "next";
  return null;
}

function ensureWired() {
  if (stepper) return;
  stepper = createHoldStepper({
    getTarget: () => target,
    schedule: (fn) => {
      const id = setInterval(fn, HOLD_STEP_MS);
      return () => clearInterval(id);
    },
  });

  document.addEventListener("keydown", (e) => {
    const dir = directionForKey(e.key);
    if (!dir) return;
    // Ignore the OS auto-repeat — we drive repetition ourselves.
    if (e.repeat) return;
    // Don't navigate while typing in a field…
    const el = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
    // …or hijack the browser's history shortcuts (Cmd+←/→ on macOS,
    // Alt+←/→ on Windows/Linux) or other modified arrow presses.
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    stepper!.press(dir);
  });
  document.addEventListener("keyup", (e) => {
    const dir = directionForKey(e.key);
    if (dir) stepper!.release(dir);
  });
  // A key released while the tab is unfocused never fires keyup; stop on
  // blur/hide so a held key can't keep stepping in the background.
  window.addEventListener("blur", () => stepper!.stop());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stepper!.stop();
  });
}

/**
 * Point the hold-navigation controller at the photo currently on screen.
 * Call from an effect; the returned disposer clears the target on unmount
 * (without disturbing an in-progress hold, which the controller owns).
 */
export function setHoldNavTarget(next: HoldTarget): () => void {
  ensureWired();
  target = next;
  return () => {
    // Only clear if this target is still the active one — on a remount the new
    // instance registers before the old instance's cleanup runs.
    if (target === next) target = null;
  };
}
