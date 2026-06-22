import { describe, expect, it } from "vitest";
import { computeReorder, type OrderedItem } from "./ordering.js";

/** Apply updates onto items and return the resulting id order (sorted by position). */
function orderAfter(items: OrderedItem[], updates: { id: string; position: string }[]): string[] {
  const pos = new Map(items.map((i) => [i.id, i.position]));
  for (const u of updates) pos.set(u.id, u.position);
  return [...pos.entries()]
    .map(([id, position]) => ({ id, position: position as string }))
    .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
    .map((i) => i.id);
}

const keyed: OrderedItem[] = [
  { id: "a", position: "a0" },
  { id: "b", position: "a1" },
  { id: "c", position: "a2" },
];

describe("computeReorder (already-keyed list)", () => {
  it("moves an item to the front when afterId is null", () => {
    const updates = computeReorder(keyed, "c", null);
    expect(orderAfter(keyed, updates)).toEqual(["c", "a", "b"]);
    // Only the moved row changes.
    expect(updates.map((u) => u.id)).toEqual(["c"]);
  });

  it("moves an item to sit after a middle item", () => {
    const updates = computeReorder(keyed, "a", "b"); // a goes after b
    expect(orderAfter(keyed, updates)).toEqual(["b", "a", "c"]);
  });

  it("moves an item to the end", () => {
    const updates = computeReorder(keyed, "a", "c"); // a goes after c (last)
    expect(orderAfter(keyed, updates)).toEqual(["b", "c", "a"]);
  });

  it("is a no-op-equivalent when moved after its current predecessor", () => {
    const updates = computeReorder(keyed, "b", "a"); // b already after a
    expect(orderAfter(keyed, updates)).toEqual(["a", "b", "c"]);
  });
});

describe("computeReorder (backfills null positions)", () => {
  const mixed: OrderedItem[] = [
    { id: "a", position: null },
    { id: "b", position: null },
    { id: "c", position: null },
  ];

  it("assigns keys to every null row and applies the move", () => {
    const updates = computeReorder(mixed, "c", null); // c to front
    // Every row gets a non-empty string key...
    const pos = new Map(updates.map((u) => [u.id, u.position]));
    expect(pos.size).toBe(3);
    for (const v of pos.values()) expect(typeof v).toBe("string");
    // ...and the resulting order honors the move.
    expect(orderAfter(mixed, updates)).toEqual(["c", "a", "b"]);
  });

  it("preserves the order of already-keyed rows when backfilling trailing nulls", () => {
    const partial: OrderedItem[] = [
      { id: "a", position: "a0" },
      { id: "b", position: null },
    ];
    const updates = computeReorder(partial, "a", "b"); // a after b
    expect(orderAfter(partial, updates)).toEqual(["b", "a"]);
  });
});

describe("computeReorder (edge cases)", () => {
  it("returns an empty array for a single-item list moved to front", () => {
    expect(computeReorder([{ id: "a", position: "a0" }], "a", null)).toEqual([]);
  });

  it("throws when movedId is not in the list", () => {
    expect(() => computeReorder(keyed, "zzz", null)).toThrow();
  });
});
