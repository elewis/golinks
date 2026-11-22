// The add-link form, one implementation for every surface: the toolbar popup,
// the not-found page and go/help. Pure logic first (unit tested), DOM glue
// after. Needs api.js and links.js (readLinks) loaded first.

const RESERVED_NAMES = ["help"];

// What the user typed, as a link name: trimmed, without a leading "go/",
// lowercase (names are case-insensitive).
function normalizeLinkName(raw: string): string {
  return raw.trim().replace(/^go\//i, "").toLowerCase();
}

// A URL for comparing: trimmed, without one trailing "/".
function comparableUrl(url: string): string {
  return url.trim().replace(/\/$/, "");
}

type LinkCheck =
  | { ok: false; errors: { name?: string; url?: string } }
  // overwrites: the destination the name has now, when it is taken (and differs).
  | { ok: true; name: string; url: string; overwrites?: string };

// A redirect target the browser accepts: an absolute http(s) URL. One bad
// stored link would make every later rule update fail, so it is refused here.
// "%s" (the parameter slot) is checked as a placeholder.
function isFullUrl(url: string): boolean {
  if (/\s/.test(url)) return false;
  try {
    const { protocol } = new URL(url.replace("%s", "x"));
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function checkLink(rawName: string, rawUrl: string, links: Links): LinkCheck {
  const name = normalizeLinkName(rawName);
  const url = rawUrl.trim();
  const errors: { name?: string; url?: string } = {};
  if (!name) errors.name = "Enter a name.";
  else if (name.includes("/")) errors.name = 'A name cannot contain "/".';
  else if (/\s/.test(name)) errors.name = "A name cannot contain spaces.";
  else if (/[?#]/.test(name)) errors.name = 'A name cannot contain "?" or "#".';
  else if (RESERVED_NAMES.includes(name)) errors.name = `go/${name} is reserved.`;
  if (!url) errors.url = "Enter a URL.";
  else if (!isFullUrl(url)) errors.url = "Enter a full URL starting with http:// or https://";
  if (errors.name || errors.url) return { ok: false, errors };
  // Any case variant of the name counts as taken; the exact key first.
  const key = Object.hasOwn(links, name) ? name : Object.keys(links).find((k) => k.toLowerCase() === name);
  const current = key === undefined ? undefined : links[key];
  if (current !== undefined && current !== url) return { ok: true, name, url, overwrites: current };
  return { ok: true, name, url };
}

// Names of every link (user or default) that points at the URL.
function linksForUrl(links: Links, url: string): string[] {
  const wanted = comparableUrl(url);
  if (!wanted) return [];
  return Object.keys(links).filter((name) => comparableUrl(links[name]!) === wanted);
}

// Writes one link into the user's links, lowercase, replacing any case variant.
async function saveLink(name: string, url: string): Promise<void> {
  const { localLinks }: { localLinks?: Links } = await api.storage.sync.get("localLinks");
  await api.storage.sync.set({ localLinks: { ...removeLinkName(localLinks || {}, name), [name.toLowerCase()]: url } });
}

// Builds the form inside `container`. The caller passes what to prefill; the
// other field starts empty, and the empty one gets the focus.
// With `table` (go/help) the controls become rows of that table instead: name
// under its first column, URL under its second (each as wide as the column),
// the button after them, and the messages in a full-width row below. The
// <form> element stays in `container`; the controls point at it by `form=`.
function initLinkForm(
  container: HTMLElement,
  prefill: { name?: string; url?: string } = {},
  table?: HTMLTableElement,
): void {
  const doc = container.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text = "") => {
    const e = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    e.textContent = text;
    return e;
  };

  const form = el("form", { id: "add-link-form" });
  const nameInput = el("input", { type: "text", id: "link-name", placeholder: "go/newlink", autocomplete: "off" });
  const urlInput = el("input", {
    type: "text",
    id: "link-url",
    placeholder: "https://example.com",
    autocomplete: "off",
  });
  const nameError = el("div", { id: "link-name-error", role: "alert" });
  const urlError = el("div", { id: "link-url-error", role: "alert" });
  const addBtn = el("button", { type: "submit", id: "add-btn" }, "Add");
  const status = el("div", { id: "link-status", role: "status" });
  const existing = el("div", { id: "link-existing" });
  const existingList = el("ul", { id: "link-existing-list" });
  existing.append(el("div", {}, "Existing go links for this URL:"), existingList);
  existing.hidden = true;

  // One inline row, as go/help always had it: name, URL, button to the right.
  // No visible labels; the inputs carry aria-labels. Messages go below the row.
  nameInput.setAttribute("aria-label", "Link name");
  urlInput.setAttribute("aria-label", "Link URL");
  const cellOf = (kid: HTMLElement, colSpan = 1) => {
    const td = el("td");
    if (colSpan > 1) td.colSpan = colSpan;
    td.append(kid);
    return td;
  };
  if (table) {
    const tfoot = el("tfoot");
    const controls = el("tr");
    const messages = el("tr");
    for (const control of [nameInput, urlInput, addBtn]) control.setAttribute("form", form.id);
    for (const input of [nameInput, urlInput]) {
      input.style.width = "100%";
      input.style.boxSizing = "border-box";
    }
    // Same right padding as the other cells, so the boxes end where the columns' text does.
    const name = cellOf(nameInput);
    const url = cellOf(urlInput);
    name.style.paddingRight = url.style.paddingRight = "1em";
    // The button spans the usage and delete columns: the overwrite text is long.
    controls.append(name, url, cellOf(addBtn, 4));
    const rest = el("div");
    rest.append(nameError, urlError, existing, status);
    messages.append(cellOf(rest, 6));
    tfoot.append(controls, messages);
    table.append(tfoot);
    container.append(form);
  } else {
    const tr = el("tr");
    tr.append(cellOf(nameInput), cellOf(urlInput), cellOf(addBtn));
    const inputRow = el("table");
    inputRow.append(tr);
    form.append(inputRow, nameError, urlError, existing, status);
    container.append(form);
  }

  nameInput.value = prefill.name ?? "";
  urlInput.value = prefill.url ?? "";
  (prefill.url ? nameInput : urlInput).focus();

  let known: Links = {};
  // The name whose overwrite the user has been asked to confirm.
  let confirming: string | null = null;

  function resetConfirm(): void {
    confirming = null;
    addBtn.textContent = "Add";
  }

  function showExisting(): void {
    existingList.replaceChildren(...linksForUrl(known, urlInput.value).map((name) => el("li", {}, `go/${name}`)));
    existing.hidden = existingList.childElementCount === 0;
  }

  async function reload(): Promise<void> {
    known = await readLinks();
    showExisting();
  }

  nameInput.addEventListener("input", () => {
    resetConfirm();
    nameError.textContent = "";
    status.textContent = "";
  });
  urlInput.addEventListener("input", () => {
    resetConfirm();
    urlError.textContent = "";
    status.textContent = "";
    showExisting();
  });
  api.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "sync" && (changes.localLinks || changes.defaultLinks)) reload().catch(() => {});
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submit().catch((err) => {
      status.textContent = `Could not save: ${err instanceof Error ? err.message : String(err)}`;
    });
  });

  async function submit(): Promise<void> {
    nameError.textContent = "";
    urlError.textContent = "";
    status.textContent = "";
    // Read at submit time: the links may have changed since the page opened.
    known = await readLinks();
    const result = checkLink(nameInput.value, urlInput.value, known);
    if (!result.ok) {
      nameError.textContent = result.errors.name ?? "";
      urlError.textContent = result.errors.url ?? "";
      resetConfirm();
      return;
    }
    if (result.overwrites !== undefined && confirming !== result.name) {
      // Never overwrite silently: show what it points to now, ask again.
      confirming = result.name;
      addBtn.textContent = `Overwrite go/${result.name} (now -> ${result.overwrites})`;
      return;
    }
    await saveLink(result.name, result.url);
    resetConfirm();
    // Saved: empty boxes for the next link; the status keeps saying what was saved.
    nameInput.value = "";
    urlInput.value = "";
    nameInput.focus();
    status.textContent = `Saved go/${result.name}`;
    await reload();
  }

  reload().catch(() => {});
}
