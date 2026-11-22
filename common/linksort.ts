// Sorting of the go/help Links table: pure functions, no DOM. Needs metrics.js (LinkStat).

type SortColumn = "link" | "destination" | "hits" | "lastHit" | "lastEdit";
type SortDir = "asc" | "desc";
type Sort = { column: SortColumn; dir: SortDir };

const SORT_COLUMNS: SortColumn[] = ["link", "destination", "hits", "lastHit", "lastEdit"];
const DEFAULT_SORT: Sort = { column: "link", dir: "asc" };

const nameCollator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

// A stored choice (storage.local `helpSort`) that is missing or not a known column and direction is the default.
function validSort(value: unknown): Sort {
  const v = value as { column?: unknown; dir?: unknown } | null | undefined;
  if (
    v &&
    typeof v === "object" &&
    SORT_COLUMNS.includes(v.column as SortColumn) &&
    (v.dir === "asc" || v.dir === "desc")
  )
    return { column: v.column as SortColumn, dir: v.dir };
  return { ...DEFAULT_SORT };
}

// Text columns start A→Z; hits and times start with the highest / newest.
function firstDirection(column: SortColumn): SortDir {
  return column === "link" || column === "destination" ? "asc" : "desc";
}

// The sort after a click on a header: the active column flips, another one starts in its first direction.
function nextSort(current: Sort, column: SortColumn): Sort {
  if (current.column === column) return { column, dir: current.dir === "asc" ? "desc" : "asc" };
  return { column, dir: firstDirection(column) };
}

// The link names in display order. A link without a value (no last hit, no last edit) is after those
// with one in either direction; ties break by name A→Z.
function sortedNames(links: Links, metrics: LinkMetrics, sort: Sort): string[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const number = (name: string): number | undefined => {
    const stat = metrics[name.toLowerCase()];
    if (sort.column === "hits") return stat?.count ?? 0;
    return sort.column === "lastHit" ? stat?.lastHit : stat?.lastEdit;
  };
  return Object.keys(links).sort((a, b) => {
    let order = 0;
    if (sort.column === "link") order = sign * nameCollator.compare(a, b);
    else if (sort.column === "destination") order = sign * nameCollator.compare(links[a] ?? "", links[b] ?? "");
    else {
      const x = number(a);
      const y = number(b);
      if (x === undefined || y === undefined) order = x === y ? 0 : x === undefined ? 1 : -1;
      else order = sign * (x - y);
    }
    return order || nameCollator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
  });
}
