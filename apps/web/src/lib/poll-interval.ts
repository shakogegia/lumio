/** Poll cadence (ms): null = paused (hidden tab); fast when active, slow when idle. */
export function pollInterval(hasActive: boolean, hidden: boolean): number | null {
  if (hidden) return null;
  return hasActive ? 1500 : 5000;
}
