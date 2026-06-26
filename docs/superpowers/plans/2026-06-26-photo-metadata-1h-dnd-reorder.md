# Photo Metadata 1h — Drag-and-Drop Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Replace the up/down reorder buttons in the metadata builder with **drag-and-drop using a grip handle** — for fields (within their group) and for groups. Backend already exists (1g: `POST /metadata/reorder` + `reorderMetadataField`/`reorderMetadataGroup`). This is a UI-only change.

**Architecture:** Mirror the existing, proven native-HTML5-DnD pattern in `apps/web/src/app/(app)/settings/catalogs/catalogs-list.tsx` (drag handle, `draggable`, `onDragStart`/`onDragOver`/`onDragEnd`, optimistic local reorder, persist a single "move after X"). Adapt it to two levels: groups reorder among groups; fields reorder among their **own group's** fields. Persist via the 1g `reorder(kind, movedId, afterId)` handler already in the form.

**Tech Stack:** React client, native HTML5 DnD, lucide `GripVertical`, the existing `/metadata/reorder` route.

---

## File structure
- Modify `apps/web/src/app/(app)/settings/metadata/[id]/metadata-config-form.tsx` only.

## Reference
Open `apps/web/src/app/(app)/settings/catalogs/catalogs-list.tsx` and copy its DnD idiom: local `items` state synced from props via `useEffect`; `onDragStart(id)`, `onDragOver(targetId)` (which optimistically moves the dragged row before the hovered one), `onDragEnd` (persist only if the order changed); a `GripVertical` handle; `draggable` on the row; `opacity-50` on the dragging row; `bg-card` solid surface. Reuse the `moveAfter(rows, id, afterId)` helper shape.

---

### Task 1: Local state + drop persistence

- [ ] **Step 1:** Add, at the top of the component:

```tsx
import { useEffect } from "react"; // ensure imported
import { GripVertical } from "lucide-react"; // add to lucide import; REMOVE ChevronUp/ChevronDown

// inside the component:
const [local, setLocal] = useState(schema);
useEffect(() => {
  setLocal(schema); // re-sync after server refresh()
}, [schema]);
// one drag at a time, discriminated by kind:
const [drag, setDrag] = useState<{ kind: "group" | "field"; id: string; groupId?: string } | null>(null);
```

- [ ] **Step 2:** Render the builder from `local` (not `schema`). Replace `schema.map((group, gi) => …)` with `local.map((group) => …)` and `group.fields.map((f, fi) => …)` with `group.fields.map((f) => …)` (indexes no longer needed). Keep everything else in the row (label Input, type Select, enabled Switch, choice OptionsEditor, delete Button).

- [ ] **Step 3:** Group DnD. Make each group's outer `<div>` `draggable` with a `GripVertical` handle in the header (replace the ChevronUp/ChevronDown buttons). Handlers:

```tsx
function onGroupDragOver(targetId: string) {
  if (drag?.kind !== "group" || drag.id === targetId) return;
  setLocal((cur) => {
    const ids = cur.map((g) => g.id);
    const from = ids.indexOf(drag.id);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return cur;
    const next = [...cur];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    return next;
  });
}
function onGroupDrop() {
  if (drag?.kind !== "group") return;
  const idx = local.findIndex((g) => g.id === drag.id);
  const afterId = idx > 0 ? local[idx - 1]!.id : null;
  setDrag(null);
  void reorder("group", drag.id, afterId);
}
```

Group wiring:
```tsx
<div
  key={group.id}
  className={cn("space-y-2", drag?.kind === "group" && drag.id === group.id && "opacity-50")}
  draggable
  onDragStart={() => setDrag({ kind: "group", id: group.id })}
  onDragOver={(e) => { e.preventDefault(); onGroupDragOver(group.id); }}
  onDragEnd={onGroupDrop}
>
  <div className="flex items-center gap-2">
    <span className="cursor-grab text-muted-foreground/60 active:cursor-grabbing"><GripVertical className="size-4" aria-hidden /></span>
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
  </div>
  …
```

(`cn` is from `@/lib/utils` — add the import.)

- [ ] **Step 4:** Field DnD (within the group). Each field row `draggable`, with a grip handle; reorders only among siblings in the same group:

```tsx
function onFieldDragOver(groupId: string, targetId: string) {
  if (drag?.kind !== "field" || drag.groupId !== groupId || drag.id === targetId) return;
  setLocal((cur) =>
    cur.map((g) => {
      if (g.id !== groupId) return g;
      const ids = g.fields.map((f) => f.id);
      const from = ids.indexOf(drag.id);
      const to = ids.indexOf(targetId);
      if (from === -1 || to === -1) return g;
      const fields = [...g.fields];
      const [moved] = fields.splice(from, 1);
      fields.splice(to, 0, moved!);
      return { ...g, fields };
    }),
  );
}
function onFieldDrop(groupId: string) {
  if (drag?.kind !== "field") return;
  const g = local.find((x) => x.id === groupId);
  const idx = g ? g.fields.findIndex((f) => f.id === drag.id) : -1;
  const afterId = idx > 0 ? g!.fields[idx - 1]!.id : null;
  setDrag(null);
  void reorder("field", drag.id, afterId);
}
```

Field row wiring (the existing `rounded-lg border bg-card px-3 py-2` row):
```tsx
<div
  key={f.id}
  className={cn("rounded-lg border bg-card px-3 py-2", drag?.kind === "field" && drag.id === f.id && "opacity-50")}
  draggable
  onDragStart={(e) => { e.stopPropagation(); setDrag({ kind: "field", id: f.id, groupId: group.id }); }}
  onDragOver={(e) => { e.preventDefault(); onFieldDragOver(group.id, f.id); }}
  onDragEnd={(e) => { e.stopPropagation(); onFieldDrop(group.id); }}
>
  <div className="flex items-center gap-2">
    <span className="cursor-grab text-muted-foreground/60 active:cursor-grabbing"><GripVertical className="size-4" aria-hidden /></span>
    <Input … />   {/* existing label input + type select + switch + delete */}
  </div>
  … {/* existing choice OptionsEditor sub-block */}
</div>
```

NOTE: `e.stopPropagation()` on the field drag events so a field drag doesn't also trigger the parent group's drag. The `reorder` handler, `setBusy`, and the `/metadata/reorder` route are unchanged from 1g.

- [ ] **Step 5:** Remove the now-unused `ChevronUp`/`ChevronDown` imports and the old up/down button JSX. Typecheck web + commit.

```bash
git add "apps/web/src/app/(app)/settings/metadata/[id]/metadata-config-form.tsx"
git commit -m "feat(metadata): drag-and-drop reorder (grip handle) for fields & groups"
```

---

### Task 2: Verify
- [ ] `pnpm --filter @lumio/web exec tsc --noEmit` → clean.
- [ ] **Browser smoke** (controller): drag a field by its grip within a group → order updates and persists on refresh; dragging a field doesn't drag its group; drag a group → groups reorder; the Info tab reflects the new order.

## Self-review
- **Spec coverage:** DnD reorder via grip handle for fields (within group) + groups ✓. Cross-group field moves still out of scope (a field's DnD is scoped to its group). Reuses the 1g backend untouched.
- **Type consistency:** `reorder("field"|"group", movedId, afterId)` matches the existing handler; `local` mirrors the `MetadataSchema` prop shape.

## Next: upload-time entry (reusing the prior-values autocomplete), then Phase 2 search + smart albums.
