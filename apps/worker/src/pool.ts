/**
 * Run `task(i)` for every i in [0, total), with at most `limit` in flight at once.
 * A `limit` of 0 spawns no workers and so runs no tasks.
 */
export async function runPool(
  total: number,
  limit: number,
  task: (i: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  async function worker(): Promise<void> {
    while (next < total) {
      const i = next++;
      await task(i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, total) }, worker));
}
