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

  function cell(text: string): HTMLTableCellElement {
    const cell = document.createElement("td");
    const cellText = document.createTextNode(text);
    cell.appendChild(cellText);
    cell.style.paddingRight = "1em";
    return cell;
  }

  function headerRow(withDelete: boolean): HTMLTableRowElement {
    const row = document.createElement("tr");
    for (const text of ["Link", "Destination", "Hits", "Last hit", "Last edited", ...(withDelete ? [""] : [])]) {
      const th = document.createElement("th");
      th.textContent = text;
      th.style.textAlign = "left";
      th.style.paddingRight = "1em";
      row.appendChild(th);
    }
    return row;
  }

  // The usage cells of a link: hits, last hit, last edited.
  function statCells(golink: string): HTMLTableCellElement[] {
    const stat = metrics[golink.toLowerCase()];
    return [cell(formatHits(stat)), cell(formatLastHit(stat)), cell(formatLastEdit(stat))];
  }

  function populateTable(tableId: string, links: Links): void {
    const table = byId(tableId);
    table.innerHTML = "";
    table.appendChild(headerRow(false));

    Object.entries(links).forEach(([golink, destination]) => {
      const row = document.createElement("tr");
      row.appendChild(cell(`go/${golink}`));
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
      row.appendChild(cell(`go/${golink}`));
      row.appendChild(cell(destination));
      for (const c of statCells(golink)) row.appendChild(c);

      const deleteCell = document.createElement("td");
      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "❌";
      deleteBtn.style.border = "none";
      deleteBtn.style.background = "transparent";
      deleteBtn.style.cursor = "pointer";
      deleteBtn.title = "Delete link";

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
