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
    pop.id("add-btn").click();
    await waitFor(async () => (await local()).gh === "https://example.com/mine", "overwrite stored");
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
