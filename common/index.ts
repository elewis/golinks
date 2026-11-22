(async () => {
  const result: { defaultLinks?: Links; localLinks?: Links } = await api.storage.sync.get([
    "defaultLinks",
    "localLinks",
  ]);

  const defaultLinks = result.defaultLinks || {};
  const localLinks = result.localLinks || {};
  // Usage metrics of this device (storage.local, see metrics.ts), by lowercase name.
  const stored: { linkMetrics?: LinkMetrics } = await api.storage.local.get("linkMetrics");
  let metrics: LinkMetrics = stored.linkMetrics || {};
  let shownLocal = localLinks;

  async function getLocalLinks(): Promise<Links> {
    const { localLinks }: { localLinks?: Links } = await api.storage.sync.get("localLinks");
    return { ...(localLinks || {}) };
  }

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

  function headerRow(withDelete: boolean): HTMLTableRowElement {
    const row = document.createElement("tr");
    for (const text of ["Link", "Destination", "Hits", "Last hit", "Last edited", ...(withDelete ? [""] : [])]) {
      const th = document.createElement("th");
      th.textContent = text;
      if (text === "Hits") th.className = "num";
      row.appendChild(th);
    }
    return row;
  }

  // The usage cells of a link: hits, last hit, last edited.
  function statCells(golink: string): HTMLTableCellElement[] {
    const stat = metrics[golink.toLowerCase()];
    return [cell(formatHits(stat), "num"), cell(formatLastHit(stat), "dim"), cell(formatLastEdit(stat), "dim")];
  }

  function populateTable(tableId: string, links: Links): void {
    const table = byId(tableId);
    table.innerHTML = "";
    table.appendChild(headerRow(false));

    Object.entries(links).forEach(([golink, destination]) => {
      const row = document.createElement("tr");
      row.appendChild(cell(`go/${golink}`, "link-name"));
      row.appendChild(cell(destination));
      for (const c of statCells(golink)) row.appendChild(c);
      table.appendChild(row);
    });
  }

  const userTable = byId<HTMLTableElement>("user-links");
  const userBody = userTable.createTBody();

  function populateUserLinks(links: Links): void {
    shownLocal = links;
    // Only the body is rebuilt: the form's rows (tfoot) keep their text, focus and listeners.
    const table = userBody;
    table.innerHTML = "";
    table.appendChild(headerRow(true));

    Object.entries(links).forEach(([golink, destination]) => {
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
        // Names are case-insensitive: remove every case variant.
        const current = await getLocalLinks();
        await api.storage.sync.set({ localLinks: removeLinkName(current, golink) });
      });

      deleteCell.appendChild(deleteBtn);
      row.appendChild(deleteCell);
      table.appendChild(row);
    });
  }

  initLinkForm(byId("add-link"), {}, userTable);
  // The shared form (and deletes from other pages) change the stored links.
  api.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "sync" && changes.localLinks)
      populateUserLinks((changes.localLinks.newValue as Links | undefined) || {});
  });

  // Hits and edits are recorded by the background; show them as they come.
  api.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== "local" || !changes.linkMetrics) return;
    metrics = (changes.linkMetrics.newValue as LinkMetrics | undefined) || {};
    populateUserLinks(shownLocal);
    populateTable("default-links", defaultLinks);
  });

  populateUserLinks(localLinks);
  populateTable("default-links", defaultLinks);
})();
