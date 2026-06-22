/** Join a child name under a catalog-relative parent ("" = catalog root). */
export function joinRel(parentRel: string, name: string): string {
  return parentRel ? `${parentRel}/${name}` : name;
}

export interface FsCrumb {
  name: string;
  /** Catalog-relative path of this crumb; "" = the catalog root. */
  rel: string;
}

/** Clickable breadcrumb trail for a catalog-relative path; root is "Library". */
export function catalogBreadcrumbs(rel: string): FsCrumb[] {
  const crumbs: FsCrumb[] = [{ name: "Library", rel: "" }];
  const clean = rel.replace(/^\/+|\/+$/g, "");
  if (!clean) return crumbs;
  let acc = "";
  for (const part of clean.split("/")) {
    if (!part) continue;
    acc = joinRel(acc, part);
    crumbs.push({ name: part, rel: acc });
  }
  return crumbs;
}
