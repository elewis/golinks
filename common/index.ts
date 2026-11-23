(async () => {
  const links = await readLinks();
  // Usage metrics of this device (storage.local, see metrics.ts), by lowercase name.
  const stored: { linkMetrics?: LinkMetrics } = await api.storage.local.get("linkMetrics");
  let metrics: LinkMetrics = stored.linkMetrics || {};
  let shownLinks = links;
  // The sort of the table, remembered per device (storage.local, not synced).
  const { helpSort }: { helpSort?: unknown } = await api.storage.local.get("helpSort");
  let sort: Sort = validSort(helpSort);
  // The two data settings of this device (storage.local); see metricsEnabled() and redirectLogEnabled().
  const settings = await api.storage.local.get([METRICS_ENABLED_KEY, REDIRECT_LOG_ENABLED_KEY]);
  let metricsOn = metricsEnabled(settings[METRICS_ENABLED_KEY]);

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

  /** The Link cell: `go/<name>` as a real link (same tab, like typing it). */
  function golinkCell(name: string): HTMLTableCellElement {
    const td = cell("", "link-name");
    const a = document.createElement("a");
    a.href = golinkHref(name);
    a.textContent = `go/${name}`;
    td.appendChild(a);
    return td;
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
      if (column === "hits" || column === "lastHit" || column === "lastEdit") th.classList.add("metric");
      if (column) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sort-btn";
        button.textContent = text;
        button.addEventListener("click", () => {
          sort = nextSort(shownSort(), column);
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
      if (column === shownSort().column) th.setAttribute("aria-sort", sort.dir === "asc" ? "ascending" : "descending");
      else th.removeAttribute("aria-sort");
    }
  }

  // The sort in use: the stored one, except that a sort on a hidden column shows as the default (the stored value stays).
  function shownSort(): Sort {
    return effectiveSort(sort, metricsOn);
  }

  // The usage cells of a link: hits, last hit, last edited.
  function statCells(golink: string): HTMLTableCellElement[] {
    const stat = metrics[golink.toLowerCase()];
    const cells = [cell(formatHits(stat), "num"), cell(formatLastHit(stat), "dim"), cell(formatLastEdit(stat), "dim")];
    for (const c of cells) c.classList.add("metric");
    return cells;
  }

  const linksTable = byId<HTMLTableElement>("links");
  linksTable.createTHead().appendChild(headerRow());
  const linksBody = linksTable.createTBody();
  linksTable.classList.toggle("no-metrics", !metricsOn);

  function populateLinks(links: Links): void {
    shownLinks = links;
    // Only the body is rebuilt: the form's rows (tfoot) keep their text, focus and listeners.
    const table = linksBody;
    table.innerHTML = "";
    showSort();

    for (const golink of sortedNames(links, metrics, shownSort())) {
      const destination = links[golink] ?? "";
      const row = document.createElement("tr");
      row.appendChild(golinkCell(golink));
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

  // The one confirmation dialog (index.html): resolves true only for the confirm button; Cancel, Escape and a click
  // on the backdrop (the dialog element itself; its padding is on the inner form) resolve false.
  const dialog = byId<HTMLDialogElement>("confirm-dialog");
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close("cancel");
  });
  function confirmDialog(title: string, text: string, confirmLabel: string): Promise<boolean> {
    byId("confirm-title").textContent = title;
    byId("confirm-text").textContent = text;
    byId("confirm-ok").textContent = confirmLabel;
    dialog.returnValue = "";
    return new Promise((resolve) => {
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
      dialog.showModal();
    });
  }

  // A danger button: confirm first, then act; nothing happens on cancel.
  function dangerButton(
    buttonId: string,
    confirm: { title: string; text: string; label: string },
    act: () => Promise<void>,
    done: string,
  ): void {
    byId(buttonId).addEventListener("click", async () => {
      byId("settings-status").textContent = "";
      byId("settings-error").textContent = "";
      if (!(await confirmDialog(confirm.title, confirm.text, confirm.label))) return;
      try {
        await act();
        byId("settings-status").textContent = done;
      } catch (e) {
        byId("settings-error").textContent = `Could not complete: ${e instanceof Error ? e.message : e}`;
      }
    });
  }

  dangerButton(
    "reset-btn",
    {
      title: "Reset to default?",
      text:
        "This removes all your links and adds the default ones again, on every device that syncs them. On this " +
        "device it also clears the hit counts, the redirect log, the table's sort order and the appearance setting. It cannot be undone.",
      label: "Reset everything",
    },
    async () => {
      await factoryReset();
      sort = DEFAULT_SORT;
      populateLinks(shownLinks);
    },
    "Reset to default.",
  );
  dangerButton(
    "clear-btn",
    {
      title: "Clear metrics?",
      text:
        "This deletes the hit counts, last-hit times and the redirect log of this device only. " +
        "It cannot be undone. Your links are not changed.",
      label: "Clear metrics",
    },
    clearMetrics,
    "Metrics cleared.",
  );

  // Appearance (appearance.ts does the painting): the segmented control shows and sets the stored mode.
  const modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".segmented button[data-mode]"));
  function showAppearance(value: unknown): void {
    const mode = validAppearance(value);
    for (const button of modeButtons) button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
  }
  for (const button of modeButtons)
    button.addEventListener("click", () => {
      const mode = validAppearance(button.dataset.mode);
      showAppearance(mode);
      setAppearance(mode).catch(() => {});
    });
  api.storage.local.get(APPEARANCE_KEY).then((stored) => showAppearance(stored[APPEARANCE_KEY]));
  api.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local" && changes[APPEARANCE_KEY]) showAppearance(changes[APPEARANCE_KEY].newValue);
  });

  initLinkForm(byId("add-link"), {}, linksTable);

  // The form's rows are made for six columns (the add button spans the three usage columns and the delete one).
  // With the usage columns hidden there are three: the URL box takes the delete column too, and the button gets
  // a row of its own under the boxes.
  const [controlsRow, messagesRow] = Array.from(linksTable.tFoot?.rows ?? []);
  const [, urlCell, buttonCell] = Array.from(controlsRow.cells);
  const addButton = byId("add-btn");
  const buttonRow = document.createElement("tr");
  const buttonRowCell = buttonRow.insertCell();
  buttonRowCell.colSpan = 3;
  function layoutForm(): void {
    urlCell.colSpan = metricsOn ? 1 : 2;
    buttonCell.hidden = !metricsOn;
    messagesRow.cells[0].colSpan = metricsOn ? 6 : 3;
    if (metricsOn) {
      buttonRow.remove();
      buttonCell.append(addButton);
    } else {
      buttonRowCell.append(addButton);
      controlsRow.after(buttonRow);
    }
  }
  layoutForm();

  // The data settings: two checkboxes (metrics default on, log default off), kept in step with storage.local.
  const metricsBox = byId<HTMLInputElement>("metrics-enabled");
  const logBox = byId<HTMLInputElement>("log-enabled");
  metricsBox.checked = metricsOn;
  logBox.checked = redirectLogEnabled(settings[REDIRECT_LOG_ENABLED_KEY]);
  for (const [box, key] of [
    [metricsBox, METRICS_ENABLED_KEY],
    [logBox, REDIRECT_LOG_ENABLED_KEY],
  ] as const)
    box.addEventListener("change", () => {
      byId("settings-error").textContent = "";
      api.storage.local.set({ [key]: box.checked }).catch((e) => {
        byId("settings-error").textContent = `Could not save: ${e instanceof Error ? e.message : e}`;
      });
    });
  api.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== "local") return;
    if (changes[REDIRECT_LOG_ENABLED_KEY])
      logBox.checked = redirectLogEnabled(changes[REDIRECT_LOG_ENABLED_KEY].newValue);
    if (changes[METRICS_ENABLED_KEY]) {
      metricsOn = metricsEnabled(changes[METRICS_ENABLED_KEY].newValue);
      metricsBox.checked = metricsOn;
      linksTable.classList.toggle("no-metrics", !metricsOn);
      layoutForm();
      populateLinks(shownLinks);
    }
  });
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
