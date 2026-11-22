(async () => {
  const links = await readLinks();
  // Usage metrics of this device (storage.local, see metrics.ts), by lowercase name.
  const stored: { linkMetrics?: LinkMetrics } = await api.storage.local.get("linkMetrics");
  let metrics: LinkMetrics = stored.linkMetrics || {};
  let shownLinks = links;
  // The sort of the table, remembered per device (storage.local, not synced).
  const { helpSort }: { helpSort?: unknown } = await api.storage.local.get("helpSort");
  let sort: Sort = validSort(helpSort);

  // An element the page is known to have (see index.html).
  function byId<T extends HTMLElement = HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (!el) throw new Error(`index.html has no #${id}`);
    return el as T;
  }

  function cell(text: string, className = ""): HTMLTableCellElement {
    const cell = document.createElement("td");
    cell.textContent = text;
    if (className) cell.className = className;
    return cell;
  }

  // The delete button's ×: an inline stroke icon that takes the button's colour.
  function crossIcon(): SVGSVGElement {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    for (const [k, v] of Object.entries({
      "aria-hidden": "true",
      width: "14",
      height: "14",
      viewBox: "0 0 14 14",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.5",
      "stroke-linecap": "round",
    }))
      svg.setAttribute(k, v);
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", "M3 3l8 8M11 3l-8 8");
    svg.append(path);
    return svg;
  }

  const COLUMN_LABELS: [SortColumn | null, string][] = [
    ["link", "Link"],
    ["destination", "Destination"],
    ["hits", "Hits"],
    ["lastHit", "Last hit"],
    ["lastEdit", "Last edited"],
    [null, ""],
  ];
  const sortButtons = new Map<SortColumn, HTMLButtonElement>();

  // Built once (a rebuild would lose the focus of the button just clicked); showSort() marks the active column.
  function headerRow(): HTMLTableRowElement {
    const row = document.createElement("tr");
    for (const [column, text] of COLUMN_LABELS) {
      const th = document.createElement("th");
      if (column === "hits") th.className = "num";
      if (column) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sort-btn";
        button.textContent = text;
        button.addEventListener("click", () => {
          sort = nextSort(sort, column);
          api.storage.local.set({ helpSort: sort }).catch(() => {});
          populateLinks(shownLinks);
        });
        sortButtons.set(column, button);
        th.appendChild(button);
      }
      row.appendChild(th);
    }
    return row;
  }

  function showSort(): void {
    for (const [column, button] of sortButtons) {
      const th = button.parentElement as HTMLElement;
      if (column === sort.column) th.setAttribute("aria-sort", sort.dir === "asc" ? "ascending" : "descending");
      else th.removeAttribute("aria-sort");
    }
  }

  // The usage cells of a link: hits, last hit, last edited.
  function statCells(golink: string): HTMLTableCellElement[] {
    const stat = metrics[golink.toLowerCase()];
    return [cell(formatHits(stat), "num"), cell(formatLastHit(stat), "dim"), cell(formatLastEdit(stat), "dim")];
  }

  const linksTable = byId<HTMLTableElement>("links");
  linksTable.createTHead().appendChild(headerRow());
  const linksBody = linksTable.createTBody();

  function populateLinks(links: Links): void {
    shownLinks = links;
    // Only the body is rebuilt: the form's rows (tfoot) keep their text, focus and listeners.
    const table = linksBody;
    table.innerHTML = "";
    showSort();

    for (const golink of sortedNames(links, metrics, sort)) {
      const destination = links[golink] ?? "";
      const row = document.createElement("tr");
      row.appendChild(cell(`go/${golink}`, "link-name"));
      row.appendChild(cell(destination));
      for (const c of statCells(golink)) row.appendChild(c);

      const deleteCell = document.createElement("td");
      deleteCell.className = "icon-cell";
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "icon-btn";
      deleteBtn.title = "Delete link";
      deleteBtn.setAttribute("aria-label", `Delete go/${golink}`);
      deleteBtn.append(crossIcon());

      deleteBtn.addEventListener("click", async () => {
        await api.storage.sync.remove(linkKey(golink));
      });

      deleteCell.appendChild(deleteBtn);
      row.appendChild(deleteCell);
      table.appendChild(row);
    }
  }

  initLinkForm(byId("add-link"), {}, linksTable);
  // The shared form (and deletes from other pages) change the stored links.
  api.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "sync" && linkChanges(changes)) readLinks().then(populateLinks, () => {});
  });

  // Hits and edits are recorded by the background; show them as they come.
  api.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== "local" || !changes.linkMetrics) return;
    metrics = (changes.linkMetrics.newValue as LinkMetrics | undefined) || {};
    populateLinks(shownLinks);
  });

  populateLinks(links);
})();
