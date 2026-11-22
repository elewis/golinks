"use strict";
// Test-only page (never shipped). Performs the operation named in ?op= against
// the options form in index.html, then publishes the outcome in its own URL
// fragment (#result=<hex json>): WebDriver cannot script or read the title of
// moz-extension:// pages, but can read their URL.
//   op=add  add go/zzmine -> https://example.com/mine through the form
//   op=del  click the delete button of the go/zzmine row
//   op=writes  add zza, zzb, zzc then delete zzb, counting the form's
//              storage.sync.set calls per action
//   op=burst  write storage 6 times without awaiting between writes
//   op=addlink  drive the shared add-link form on notfound.html, popup.html
//               and index.html (prefill, validation, existing links, overwrite)
//   op=seed     (pnpm screenshot) store the links from seed.json
//   op=frame    (pnpm screenshot) show the extension page named in shot.json
//               in a full-window iframe, fill its fields, report its size
//   op=danger   drive the danger buttons of index.html Settings (reset links, clear metrics; cancel and confirm)
//   op=theme    the Appearance control and the page colours (the browser is dark)
//   op=regex  store links whose names contain regex characters (a.b, c++)
const LINK = { name: "zzmine", url: "https://example.com/mine" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, what, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const hasRule = async (name) =>
  (await browser.declarativeNetRequest.getDynamicRules()).some((r) =>
    JSON.stringify(r.condition).includes(`go/${name}`),
  );

// Links are one sync item each, `link:<name>`.
const storedLinks = async () =>
  Object.fromEntries(
    Object.entries(await browser.storage.sync.get(null))
      .filter(([k]) => k.startsWith("link:"))
      .map(([k, v]) => [k.slice(5), v]),
  );
const linkItems = (links) => Object.fromEntries(Object.entries(links).map(([n, u]) => [`link:${n}`, u]));
// Makes the stored links exactly `links`.
async function setLinks(links) {
  const gone = Object.keys(await storedLinks()).filter((n) => !(n in links));
  if (gone.length) await browser.storage.sync.remove(gone.map((n) => `link:${n}`));
  await browser.storage.sync.set(linkItems(links));
}

const Buffer_hex = (str) => [...new TextEncoder().encode(str)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function loadForm() {
  const frame = document.createElement("iframe");
  frame.src = "index.html";
  document.body.appendChild(frame);
  await waitFor(() => frame.contentDocument?.getElementById("add-btn"), "options form");
  return frame.contentDocument;
}

async function run(cmd) {
  if (cmd.op === "add") {
    const doc = await loadForm();
    doc.getElementById("link-name").value = LINK.name;
    doc.getElementById("link-url").value = LINK.url;
    doc.getElementById("add-btn").click();
    const stored = await waitFor(async () => {
      return (await storedLinks())[LINK.name] === LINK.url;
    }, "link in storage");
    await waitFor(() => hasRule(LINK.name), "rule for new link");
    return { stored };
  }
  if (cmd.op === "del") {
    const doc = await loadForm();
    const row = [...doc.querySelectorAll("#links tr")].find((r) => r.firstChild.textContent === `go/${LINK.name}`);
    if (!row) throw new Error(`no row for go/${LINK.name}`);
    row.querySelector("button").click();
    await waitFor(async () => {
      return !(LINK.name in (await storedLinks()));
    }, "link removed from storage");
    await waitFor(async () => !(await hasRule(LINK.name)), "rule removed");
    return {};
  }
  if (cmd.op === "deldefault") {
    // A shipped default is an ordinary link: it has a row and a delete button, and no separate table.
    const doc = await loadForm();
    const titles = [...doc.querySelectorAll("h2.section-title")].map((h) => h.textContent);
    const separate = doc.getElementById("default-links") !== null;
    await waitFor(() => doc.querySelector("#links tr td"), "link rows");
    const row = [...doc.querySelectorAll("#links tr")].find((r) => r.firstChild.textContent === "go/gg");
    if (!row) throw new Error("no row for go/gg");
    row.querySelector("button").click();
    await waitFor(async () => !(await hasRule("gg")), "rule for go/gg removed");
    return { titles, separate };
  }
  if (cmd.op === "writes") {
    const doc = await loadForm();
    const win = doc.defaultView;
    let sets = 0;
    const orig = win.browser.storage.sync.set.bind(win.browser.storage.sync);
    win.browser.storage.sync.set = (v) => (sets++, orig(v));
    const origRemove = win.browser.storage.sync.remove.bind(win.browser.storage.sync);
    win.browser.storage.sync.remove = (k) => (sets++, origRemove(k)); // a delete is one remove
    const perAction = [];
    for (const n of ["zza", "zzb", "zzc"]) {
      const before = sets;
      doc.getElementById("link-name").value = n;
      doc.getElementById("link-url").value = `https://example.com/${n}`;
      doc.getElementById("add-btn").click();
      await waitFor(() => sets > before, `storage.set for ${n}`);
      await sleep(300);
      perAction.push(sets - before);
    }
    const before = sets;
    [...doc.querySelectorAll("#links tr")]
      .find((r) => r.firstChild.textContent === "go/zzb")
      .querySelector("button")
      .click();
    await waitFor(() => sets > before, "storage.set for delete");
    await sleep(300);
    perAction.push(sets - before);
    return {
      perAction,
      keys: Object.keys(await storedLinks())
        .sort()
        .join(","),
    };
  }
  if (cmd.op === "burst") {
    await Promise.all(
      [1, 2, 3, 4, 5, 6].map((i) => browser.storage.sync.set({ [`link:zzburst${i}`]: `https://example.com/${i}` })),
    );
    await waitFor(() => hasRule("zzburst6"), "rule for the last write");
    return {};
  }
  if (cmd.op === "addlink") {
    const out = {};
    const local = storedLinks;
    const open = async (src) => {
      const frame = document.createElement("iframe");
      frame.src = src;
      document.body.appendChild(frame);
      await waitFor(() => frame.contentDocument?.getElementById("add-btn"), `form in ${src}`);
      const doc = frame.contentDocument;
      const set = (name, url) => {
        doc.getElementById("link-name").value = name;
        doc.getElementById("link-url").value = url;
        doc.getElementById("link-name").dispatchEvent(new Event("input"));
        doc.getElementById("link-url").dispatchEvent(new Event("input"));
      };
      return { doc, set, id: (i) => doc.getElementById(i) };
    };
    // Not-found page: name prefilled, URL empty and focused.
    const nf = await open("notfound.html?name=zznew");
    out.nfName = nf.id("link-name").value;
    out.nfUrl = nf.id("link-url").value;
    out.nfFocus = nf.doc.activeElement.id;
    nf.set("zznew", "example.com/new");
    nf.id("add-btn").click();
    await waitFor(async () => (await local()).zznew === "https://example.com/new", "zznew stored");
    await waitFor(() => hasRule("zznew"), "rule for zznew");
    await waitFor(() => nf.id("link-status").textContent === "Saved go/zznew", "saved message");
    out.nfAfterSave = [nf.id("link-name").value, nf.id("link-url").value, nf.doc.activeElement.id];
    // Popup page: the same form with the URL focused (no tab URL to fill).
    const pop = await open("popup.html");
    out.popName = pop.id("link-name").value;
    out.popFocus = pop.doc.activeElement.id;
    // Validation writes nothing.
    const before = JSON.stringify(await local());
    for (const name of ["", "a/b", "a b", "help"]) {
      pop.set(name, "https://x.test");
      pop.id("add-btn").click();
      await waitFor(() => pop.id("link-name-error").textContent, `error for ${JSON.stringify(name)}`);
    }
    await sleep(300);
    out.valKept = [pop.id("link-name").value, pop.id("link-url").value];
    out.validationWrote = JSON.stringify(await local()) !== before;
    // Existing links for the URL are listed, trailing slash ignored.
    pop.set("", "https://github.com/");
    await waitFor(() => pop.doc.querySelectorAll("#link-existing-list li").length, "existing list");
    out.existing = [...pop.doc.querySelectorAll("#link-existing-list li")].map((l) => l.textContent).sort();
    // Overwrite needs a confirm that names the current destination.
    pop.set("gh", "https://example.com/mine");
    pop.id("add-btn").click();
    await waitFor(() => pop.id("add-btn").textContent.startsWith("Overwrite"), "confirm button");
    out.confirmLabel = pop.id("add-btn").textContent;
    await sleep(300);
    out.wroteBeforeConfirm = (await local()).gh !== "https://github.com";
    // The popup closes itself after a save: window.close is stubbed (a frame cannot close).
    let closed = 0;
    pop.doc.defaultView.close = () => closed++;
    pop.id("add-btn").click();
    await waitFor(async () => (await local()).gh === "https://example.com/mine", "overwrite stored");
    await waitFor(() => pop.id("link-status").textContent, "popup success line");
    out.popSaved = {
      text: pop.id("link-status").textContent,
      cls: pop.id("link-status").className,
      disabled: ["link-name", "link-url", "add-btn"].map((i) => pop.id(i).disabled),
      values: [pop.id("link-name").value, pop.id("link-url").value],
      closedEarly: closed,
    };
    await waitFor(() => closed > 0, "the popup to close itself", 4000);
    out.popClosed = closed;
    // go/help has the same form.
    const help = await open("index.html");
    out.helpForms = help.doc.querySelectorAll("#add-link #add-link-form").length;
    // The form's boxes sit under the Link and Destination columns, as wide as their content box.
    const align = () => {
      const [th1, th2] = help.doc.querySelectorAll("#links th");
      const box = (th) => {
        const r = th.getBoundingClientRect();
        const s = help.doc.defaultView.getComputedStyle(th);
        const l = parseFloat(s.paddingLeft);
        return { left: r.left + l, width: r.width - l - parseFloat(s.paddingRight) };
      };
      const near = (a, b) => Math.abs(a - b) < 1;
      const [n, u] = ["link-name", "link-url"].map((i) => help.id(i).getBoundingClientRect());
      return (
        near(n.left, box(th1).left) &&
        near(n.width, box(th1).width) &&
        near(u.left, box(th2).left) &&
        near(u.width, box(th2).width)
      );
    };
    out.helpAligned = align();
    // A very long destination widens the column; the box follows.
    const long = `https://example.com/${"x".repeat(300)}`;
    await browser.storage.sync.set({ "link:zzlong": long });
    await waitFor(() => [...help.doc.querySelectorAll("#links td")].some((td) => td.textContent === long), "long row");
    out.helpAlignedLong = align();
    await browser.storage.sync.remove("link:zzlong");
    await waitFor(
      () => ![...help.doc.querySelectorAll("#links td")].some((td) => td.textContent === long),
      "long row gone",
    );
    // The confirm works from go/help's own form (its controls sit outside the <form>, tied by form=).
    help.set("gh", "https://example.com/fromhelp");
    help.id("add-btn").click();
    await waitFor(() => help.id("add-btn").textContent.startsWith("Overwrite"), "help confirm button");
    out.helpConfirmLabel = help.id("add-btn").textContent;
    await sleep(300);
    out.helpWroteBeforeConfirm = (await local()).gh === "https://example.com/fromhelp";
    help.id("add-btn").click();
    await waitFor(async () => (await local()).gh === "https://example.com/fromhelp", "help overwrite stored");
    out.helpStatus = help.id("link-status").textContent;
    out.helpAfterSave = [help.id("link-name").value, help.id("link-url").value, help.id("add-btn").textContent];
    return out;
  }
  if (cmd.op === "seed") {
    const seed = await (await fetch("seed.json")).json();
    await setLinks(seed.localLinks);
    for (const name of Object.keys(seed.localLinks)) await waitFor(() => hasRule(name), `rule for ${name}`);
    if (seed.hits) {
      // Wait for the background to record the edits, then add the sample hits to them.
      const get = async () => (await browser.storage.local.get("linkMetrics")).linkMetrics;
      const last = Object.keys(seed.localLinks).pop();
      if (last) await waitFor(async () => (await get())?.[last]?.lastEdit, "edits");
      const metrics = (await get()) ?? {};
      const now = Math.floor(Date.now() / 1000);
      for (const [name, [count, ago]] of Object.entries(seed.hits)) {
        metrics[name] = { recent: [], hourly: [], daily: [], ...metrics[name], count, lastHit: now - ago };
      }
      await browser.storage.local.set({ linkMetrics: metrics });
    }
    return {};
  }
  if (cmd.op === "frame") {
    const shot = await (await fetch("shot.json")).json();
    await browser.storage.local.remove("helpSort"); // the remembered sort is per device: each shot starts at the default
    // The appearance (pnpm screenshot --appearance): stored like the go/help control does; none is System.
    if (shot.appearance) await browser.storage.local.set({ appearance: shot.appearance });
    else await browser.storage.local.remove("appearance");
    document.body.style.margin = "0";
    const frame = document.createElement("iframe");
    frame.style.cssText = "border:0;width:100vw;height:100vh;display:block";
    frame.src = shot.src;
    document.body.appendChild(frame);
    const doc = await waitFor(
      () =>
        (frame.contentDocument?.getElementById("add-btn") || frame.contentDocument?.body?.dataset.ready) &&
        frame.contentDocument,
      `form in ${shot.src}`,
    );
    const fire = (el) => el.dispatchEvent(new Event("input", { bubbles: true }));
    for (const [id, value] of Object.entries(shot.fill || {})) {
      const el = doc.getElementById(id);
      el.value = value;
      fire(el);
    }
    if (shot.click) {
      doc.getElementById(shot.click).click();
      await sleep(300);
    }
    if (shot.sortBy) {
      [...doc.querySelectorAll("#links th button")].find((b) => b.textContent === shot.sortBy).click();
    }
    await sleep(300);
    if (parent !== window) parent.postMessage("frame-ready", "*");
    const rects = [...doc.querySelectorAll("body *")].map((e) => e.getBoundingClientRect());
    return {
      width: Math.ceil(Math.max(...rects.map((r) => r.right))),
      height: Math.ceil(Math.max(...rects.map((r) => r.bottom))),
    };
  }
  if (cmd.op === "regex") {
    await setLinks({ "a.b": "https://example.com/dot?x=%s", "c++": "https://example.com/plus?x=%s" });
    // 2 links (the seeded defaults are replaced) + help, root and not-found rules.
    await waitFor(async () => (await browser.declarativeNetRequest.getDynamicRules()).length === 5, "5 rules");
    return {};
  }
  if (cmd.op === "log") {
    // The harness's own go/zztest-* navigations are logged like any other.
    const all = await browser.storage.local.get(null);
    const keys = Object.keys(all)
      .filter((k) => k.startsWith("redirectLog:"))
      .sort();
    return { keys, entries: keys.flatMap((k) => all[k]).filter((e) => !e.link.startsWith("zztest-")) };
  }
  if (cmd.op === "logflood") {
    // 9,990 stored entries in today's key, then 20 overlapping appends: the
    // serialised queue keeps every new one and the cap trims the oldest 10.
    const bg = await browser.runtime.getBackgroundPage();
    const now = Math.floor(Date.now() / 1000);
    const key = bg.redirectDayKey(now);
    const old = Array.from({ length: 9990 }, (_, i) => ({ at: now, from: "f", link: "old", to: "t", tabId: i }));
    await browser.storage.local.set({ [key]: old });
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        bg.appendRedirectLog({ at: now, from: "f", link: "new", to: "t", tabId: i }),
      ),
    );
    const all = (await browser.storage.local.get(key))[key];
    return { count: all.length, firstTab: all[0].tabId, news: all.filter((e) => e.link === "new").map((e) => e.tabId) };
  }
  if (cmd.op === "metrics") {
    const { linkMetrics } = await browser.storage.local.get("linkMetrics");
    return { metrics: linkMetrics || {} };
  }
  if (cmd.op === "metricsedit") {
    // Edits through storage.sync, as the form (or another device) does.
    await browser.storage.sync.set({ "link:zzedit": "https://example.com/one" });
    await waitFor(async () => (await browser.storage.local.get("linkMetrics")).linkMetrics?.zzedit?.lastEdit, "edit");
    const first = (await browser.storage.local.get("linkMetrics")).linkMetrics.zzedit.lastEdit;
    // The same destination again is no edit; a deletion is none either.
    await browser.storage.sync.set({ "link:zzedit": "https://example.com/one" });
    await browser.storage.sync.remove("link:zzedit");
    await sleep(500);
    const { linkMetrics } = await browser.storage.local.get("linkMetrics");
    return { first, stat: linkMetrics.zzedit };
  }
  if (cmd.op === "metricshelp") {
    const doc = await loadForm();
    const rows = () =>
      Object.fromEntries(
        [...doc.querySelectorAll("#links tr")].map((r) => [
          r.firstChild.textContent,
          [...r.querySelectorAll("td")].map((c) => c.textContent),
        ]),
      );
    return { rows: rows() };
  }
  if (cmd.op === "helplinks") {
    const doc = await loadForm();
    await waitFor(() => doc.querySelector("#links tbody tr"), "link rows");
    const anchors = [...doc.querySelectorAll("td.link-name a")];
    return {
      hrefs: Object.fromEntries(anchors.map((a) => [a.textContent, a.getAttribute("href")])),
      cells: [...doc.querySelectorAll("td.link-name")].length,
      target: anchors.map((a) => a.target).filter(Boolean),
    };
  }
  if (cmd.op === "sort") {
    await browser.storage.local.remove("helpSort");
    const snap = (d) => ({
      names: [...d.querySelectorAll("#links tbody tr")].map((r) => r.firstChild.textContent),
      hits: [...d.querySelectorAll("#links tbody tr")].map((r) => Number(r.cells[2].textContent)),
      sorted: [...d.querySelectorAll("#links th[aria-sort]")].map(
        (th) => `${th.textContent}:${th.getAttribute("aria-sort")}`,
      ),
    });
    const header = (d, text) => [...d.querySelectorAll("#links th button")].find((b) => b.textContent === text);
    const doc = await loadForm();
    await waitFor(() => doc.querySelector("#links tbody tr"), "link rows");
    const initial = snap(doc);
    header(doc, "Hits").click();
    const hitsDesc = snap(doc);
    header(doc, "Hits").click();
    const hitsAsc = snap(doc);
    const stored = (await browser.storage.local.get("helpSort")).helpSort;
    const doc2 = await loadForm();
    await waitFor(() => doc2.querySelector("#links tbody tr"), "link rows after reload");
    const remembered = snap(doc2);
    await browser.storage.local.remove("helpSort");
    return { initial, hitsDesc, hitsAsc, stored, remembered };
  }
  if (cmd.op === "theme") {
    // Appearance: the browser is dark (pref in the throwaway profile), so System is dark; Light must win.
    const bg = (doc) => getComputedStyle(doc.body).backgroundColor;
    const stored = async () => (await browser.storage.local.get("appearance")).appearance;
    await browser.storage.local.remove("appearance");
    const doc = await loadForm();
    const out = { system: bg(doc), theme: doc.documentElement.dataset.theme ?? null };
    out.pressedSystem = doc.querySelector(".segmented [aria-pressed=true]").dataset.mode;
    doc.querySelector('.segmented [data-mode="light"]').click();
    await waitFor(() => doc.documentElement.dataset.theme === "light", "light");
    out.light = bg(doc);
    out.storedLight = await stored();
    const popup = document.createElement("iframe");
    popup.src = "popup.html";
    document.body.appendChild(popup);
    await waitFor(() => popup.contentDocument?.getElementById("add-btn"), "popup");
    out.popupLight = bg(popup.contentDocument);
    doc.querySelector('.segmented [data-mode="dark"]').click();
    await waitFor(() => bg(doc) !== out.light, "dark");
    out.dark = bg(doc);
    await waitFor(() => bg(popup.contentDocument) === out.dark, "the popup to follow");
    doc.querySelector('.segmented [data-mode="system"]').click();
    await waitFor(async () => (await stored()) === "system", "system stored");
    out.systemAgain = bg(doc);
    await browser.storage.local.set({ appearance: "sepia" });
    await sleep(300);
    out.invalid = bg(doc);
    await browser.storage.local.remove("appearance");
    return out;
  }
  if (cmd.op === "danger") {
    // The danger buttons of go/help: Cancel changes nothing, confirming does the clear / the factory reset.
    const day = "redirectLog:2026-11-20";
    const seedLocal = () =>
      browser.storage.local.set({
        linkMetrics: { zzmine: { count: 5, lastHit: 1, lastEdit: 1, recent: [], hourly: [], daily: [] } },
        [day]: [{ at: 1, from: "a", link: "zzmine", to: "b", tabId: 1 }],
        helpSort: { column: "hits", dir: "desc" },
      });
    await setLinks({ zzmine: "https://example.com/mine" });
    await sleep(500);
    await browser.storage.local.remove(["linkMetrics", "helpSort"]);
    await seedLocal();
    const doc = await loadForm();
    const dialog = doc.getElementById("confirm-dialog");
    const click = (id) => doc.getElementById(id).click();
    const settle = () => waitFor(() => !dialog.open, "the dialog to close");
    const local = () => browser.storage.local.get(null);
    const keys = async () => Object.keys(await local()).sort();
    const shipped = SHIPPED_LINKS; // links.js, loaded by test.html
    const out = { shipped };
    out.deviceIdBefore = (await local()).deviceId;
    out.buttonOrder = [...doc.querySelectorAll(".settings .btn-danger")].map((b) => b.id);

    // Clear metrics: cancel changes nothing, confirm removes metrics and log only.
    click("clear-btn");
    out.clearDialogOpen = dialog.open;
    out.clearText = doc.getElementById("confirm-text").textContent;
    click("confirm-cancel");
    await settle();
    await sleep(300);
    out.keysAfterClearCancel = await keys();
    click("clear-btn");
    click("confirm-ok");
    await settle();
    await waitFor(async () => !("linkMetrics" in (await local())), "the metrics to be cleared");
    out.keysAfterClear = await keys();
    out.linksAfterClear = await storedLinks();
    out.hitsShown = [...doc.querySelectorAll("#links tbody tr")].map((r) => r.cells[2].textContent);

    // Reset to default: cancel and Escape change nothing, confirm is a factory reset.
    await seedLocal();
    click("reset-btn");
    out.resetDialogOpen = dialog.open;
    out.resetText = doc.getElementById("confirm-text").textContent;
    click("confirm-cancel");
    await settle();
    click("reset-btn");
    dialog.close(); // what Escape does
    await settle();
    await sleep(300);
    out.linksAfterResetCancel = await storedLinks();
    out.keysAfterResetCancel = await keys();

    click("reset-btn");
    click("confirm-ok");
    await settle();
    await waitFor(async () => "gh" in (await storedLinks()), "the defaults");
    await waitFor(async () => !("helpSort" in (await local())), "helpSort to be removed");
    out.linksAfterReset = await storedLinks();
    out.seeded = Object.keys(await browser.storage.sync.get(null)).filter((k) => k.startsWith("seeded:")).length;
    out.ruleGithub = await waitFor(() => hasRule("github"), "the rule for a default");
    out.ruleMine = await hasRule("zzmine");
    await sleep(300);
    const after = await local();
    out.keysAfterReset = Object.keys(after).sort();
    out.mineStat = after.linkMetrics?.zzmine;
    out.deviceIdAfter = after.deviceId;
    return out;
  }
  throw new Error(`unknown op ${cmd.op}`);
}

(async () => {
  const cmd = { op: new URLSearchParams(location.search).get("op") };
  let out;
  try {
    out = { ok: true, ...(await run(cmd)) };
  } catch (e) {
    out = { ok: false, error: String(e) };
  }
  location.hash = `result=${Buffer_hex(JSON.stringify(out))}`;
})();
