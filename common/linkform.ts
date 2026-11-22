// The add-link form, one implementation for every surface: the toolbar popup,
// the not-found page and go/help. Pure logic first (unit tested), DOM glue
// after. Needs api.js and links.js (readLinks) loaded first.

const RESERVED_NAMES = ["help"];

// What the user typed, as a link name: trimmed, without a leading "go/",
// lowercase (names are case-insensitive; ASCII only, so the Kelvin sign K is not folded into a k).
function normalizeLinkName(raw: string): string {
  return raw
    .trim()
    .replace(/^go\//i, "")
    .replace(/[A-Z]/g, (c) => c.toLowerCase());
}

// What the user typed as a destination, trimmed. Without a scheme it gets
// "https://", or "http://" for the host localhost (only when a link is saved or looked up, never at redirect time).
// A scheme is "://" in the text, or "name:" not followed by a port digit
// (`mailto:x`, `javascript:x` keep theirs and fail the check; `localhost:8080` has none).
function withScheme(raw: string): string {
  const url = raw.trim();
  if (!url || url.includes("://") || url.startsWith("//") || /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(url)) return url;
  // Only the exact host localhost is plain http (local dev servers); everything else gets https.
  return /^localhost(?=[:/?#]|$)/i.test(url) ? `http://${url}` : `https://${url}`;
}

// A URL for comparing: with its scheme, trimmed, without one trailing "/".
function comparableUrl(url: string): string {
  return withScheme(url).replace(/\/$/, "");
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
  const url = withScheme(rawUrl);
  const errors: { name?: string; url?: string } = {};
  if (!name) errors.name = "Enter a name.";
  else if (!/^[a-z0-9_-]+$/.test(name)) errors.name = "Use only letters, digits, - and _.";
  else if (RESERVED_NAMES.includes(name)) errors.name = `go/${name} is reserved.`;
  if (!url) errors.url = "Enter a URL.";
  else if (!isFullUrl(url)) {
    // A typed scheme that is not http(s) gets the scheme hint; otherwise the URL is just invalid.
    errors.url =
      /^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^https?:/i.test(url)
        ? "Enter a full URL starting with http:// or https://"
        : "Enter a valid URL.";
  }
  if (errors.name || errors.url) return { ok: false, errors };
  // Any case variant of the name counts as taken; the exact key first.
  const key = Object.hasOwn(links, name) ? name : Object.keys(links).find((k) => k.toLowerCase() === name);
  const current = key === undefined ? undefined : links[key];
  if (current !== undefined && current !== url) return { ok: true, name, url, overwrites: current };
  return { ok: true, name, url };
}

// Names of every link that points at the URL.
function linksForUrl(links: Links, url: string): string[] {
  const wanted = comparableUrl(url);
  if (!wanted) return [];
  return Object.keys(links).filter((name) => comparableUrl(links[name]!) === wanted);
}

// Writes one link (its own sync item, name lowercase); overwriting is the same key.
async function saveLink(name: string, url: string): Promise<void> {
  await api.storage.sync.set({ [linkKey(name)]: url });
}

// The status line after a save.
function savedText(name: string, url: string): string {
  return `Saved go/${name} -> ${url}`;
}

// What a surface can do with the form once a link is saved (see `onSaved`).
type LinkFormHandle = {
  // Disables the boxes and the button: nothing more can be submitted.
  lock(): void;
  // Shows a success line (class msg-success) in place of the plain status.
  showSuccess(text: string): void;
};

// Builds the form inside `container`. The caller passes what to prefill; the
// other field starts empty, and the empty one gets the focus.
// With `table` (go/help) the controls become rows of that table instead: name
// under its first column, URL under its second (each as wide as the column),
// the button after them, and the messages in a full-width row below. The
// <form> element stays in `container`; the controls point at it by `form=`.
// `onSaved` replaces what happens after a successful save (default: empty boxes,
// focus on the name, "Saved go/x"); it gets the saved link and a handle.
function initLinkForm(
  container: HTMLElement,
  prefill: { name?: string; url?: string } = {},
  table?: HTMLTableElement,
  onSaved?: (saved: { name: string; url: string }, form: LinkFormHandle) => void,
): void {
  const doc = container.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text = "") => {
    const e = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    e.textContent = text;
    return e;
  };

  const form = el("form", { id: "add-link-form" });
  const nameInput = el("input", {
    type: "text",
    id: "link-name",
    class: "input input-mono",
    placeholder: "go/newlink",
    autocomplete: "off",
  });
  const urlInput = el("input", {
    type: "text",
    id: "link-url",
    class: "input",
    placeholder: "https://example.com",
    autocomplete: "off",
  });
  const nameError = el("div", { id: "link-name-error", class: "msg-error", role: "alert" });
  const urlError = el("div", { id: "link-url-error", class: "msg-error", role: "alert" });
  const addBtn = el("button", { type: "submit", id: "add-btn", class: "btn btn-primary" }, "Add");
  const status = el("div", { id: "link-status", class: "msg-status", role: "status" });
  const existing = el("div", { id: "link-existing", class: "note" });
  const existingList = el("ul", { id: "link-existing-list" });
  existing.append(el("div", {}, "Existing go links for this URL:"), existingList);
  existing.hidden = true;

  // go/help: one inline row in the table, no visible labels, so the inputs carry aria-labels.
  // Popup and not-found: stacked, with real <label>s (below).
  const cellOf = (kid: HTMLElement, colSpan = 1) => {
    const td = el("td");
    if (colSpan > 1) td.colSpan = colSpan;
    td.append(kid);
    return td;
  };
  if (table) {
    nameInput.setAttribute("aria-label", "Link name");
    urlInput.setAttribute("aria-label", "Link URL");
    const tfoot = el("tfoot");
    const controls = el("tr");
    const messages = el("tr");
    for (const control of [nameInput, urlInput, addBtn]) control.setAttribute("form", form.id);
    // The table's cell padding (theme.css) is the same in the header and the form rows,
    // so the boxes end where the columns' text does.
    // The button spans the usage and delete columns: the overwrite text is long.
    controls.append(cellOf(nameInput), cellOf(urlInput), cellOf(addBtn, 4));
    const rest = el("div", { class: "messages" });
    rest.append(nameError, urlError, existing, status);
    messages.append(cellOf(rest, 6));
    tfoot.append(controls, messages);
    table.append(tfoot);
    container.append(form);
  } else {
    // Stacked: labelled name and URL, the messages, the button.
    const field = (label: string, input: HTMLElement, error: HTMLElement) => {
      const wrap = el("div", { class: "field" });
      wrap.append(el("label", { class: "label", for: input.id }, label), input, error);
      return wrap;
    };
    form.className = "form";
    form.append(field("Name", nameInput, nameError), field("URL", urlInput, urlError), existing, addBtn, status);
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
    if (namespace === "sync" && linkChanges(changes)) reload().catch(() => {});
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
    if (onSaved) {
      onSaved(result, {
        lock() {
          for (const control of [nameInput, urlInput, addBtn]) control.disabled = true;
        },
        showSuccess(text) {
          status.className = "msg-success";
          status.textContent = text;
        },
      });
    } else {
      // Saved: empty boxes for the next link; the status keeps saying what was saved.
      nameInput.value = "";
      urlInput.value = "";
      nameInput.focus();
      status.textContent = `Saved go/${result.name}`;
    }
    await reload();
  }

  reload().catch(() => {});
}
