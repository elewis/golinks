(async () => {
  const result: { defaultLinks?: Links; localLinks?: Links } = await api.storage.sync.get(["defaultLinks", "localLinks"]);

  const defaultLinks = result.defaultLinks || {};
  const localLinks = result.localLinks || {};

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
    return cell;
  }

  function populateTable(tableId: string, links: Links): void {
    const table = byId(tableId);
    table.innerHTML = "";

    Object.entries(links).forEach(([golink, destination]) => {
      const row = document.createElement("tr");
      row.appendChild(cell(`go/${golink}`));
      row.appendChild(cell(destination));
      table.appendChild(row);
    });
  }

  function populateUserLinks(links: Links): void {
    const table = byId("user-links");
    table.innerHTML = "";

    Object.entries(links).forEach(([golink, destination]) => {
      const row = document.createElement("tr");
      row.appendChild(cell(`go/${golink}`));
      row.appendChild(cell(destination));

      const deleteCell = document.createElement("td");
      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "❌";
      deleteBtn.style.border = "none";
      deleteBtn.style.background = "transparent";
      deleteBtn.style.cursor = "pointer";
      deleteBtn.title = "Delete link";

      deleteBtn.addEventListener("click", async () => {
        const current = await getLocalLinks();
        delete current[golink];
        await api.storage.sync.set({ localLinks: current });
      });

      deleteCell.appendChild(deleteBtn);
      row.appendChild(deleteCell);
      table.appendChild(row);
    });
  }

  initLinkForm(byId("add-link"));
  // The shared form (and deletes from other pages) change the stored links.
  api.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "sync" && changes.localLinks) populateUserLinks((changes.localLinks.newValue as Links | undefined) || {});
  });

  populateUserLinks(localLinks);
  populateTable("default-links", defaultLinks);
})();
