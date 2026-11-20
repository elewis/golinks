"use strict";
// Test-only page (never shipped). Performs the operation named in ?op= against
// the options form in index.html, then publishes the outcome in its own URL
// fragment (#result=<hex json>): WebDriver cannot script or read the title of
// moz-extension:// pages, but can read their URL.
//   op=add  add go/zzmine -> https://example.com/mine through the form
//   op=del  click the delete button of the go/zzmine row
//   op=writes  add zza, zzb, zzc then delete zzb, counting the form's
//              storage.sync.set calls per action
const LINK = { name: "zzmine", url: "https://example.com/mine" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, what, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(50);
  }
  throw new Error("timed out waiting for " + what);
}

const hasRule = async (name) =>
  (await browser.declarativeNetRequest.getDynamicRules()).some((r) =>
    JSON.stringify(r.condition).includes(`go/${name}`)
  );

const Buffer_hex = (str) =>
  [...new TextEncoder().encode(str)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function loadForm() {
  const frame = document.createElement("iframe");
  frame.src = "index.html";
  document.body.appendChild(frame);
  await waitFor(
    () => frame.contentDocument?.getElementById("add-btn"),
    "options form"
  );
  return frame.contentDocument;
}

async function run(cmd) {
  if (cmd.op === "add") {
    const doc = await loadForm();
    doc.getElementById("link-name").value = LINK.name;
    doc.getElementById("link-url").value = LINK.url;
    doc.getElementById("add-btn").click();
    const stored = await waitFor(async () => {
      const { localLinks } = await browser.storage.sync.get("localLinks");
      return localLinks && localLinks[LINK.name] === LINK.url;
    }, "link in storage");
    await waitFor(() => hasRule(LINK.name), "rule for new link");
    return { stored };
  }
  if (cmd.op === "del") {
    const doc = await loadForm();
    const row = [...doc.querySelectorAll("#user-links tr")].find(
      (r) => r.firstChild.textContent === `go/${LINK.name}`
    );
    if (!row) throw new Error("no row for go/" + LINK.name);
    row.querySelector("button").click();
    await waitFor(async () => {
      const { localLinks } = await browser.storage.sync.get("localLinks");
      return !localLinks || !(LINK.name in localLinks);
    }, "link removed from storage");
    await waitFor(async () => !(await hasRule(LINK.name)), "rule removed");
    return {};
  }
  if (cmd.op === "writes") {
    const doc = await loadForm();
    const win = doc.defaultView;
    let sets = 0;
    const orig = win.browser.storage.sync.set.bind(win.browser.storage.sync);
    win.browser.storage.sync.set = (v) => (sets++, orig(v));
    const perAction = [];
    for (const n of ["zza", "zzb", "zzc"]) {
      const before = sets;
      doc.getElementById("link-name").value = n;
      doc.getElementById("link-url").value = `https://example.com/${n}`;
      doc.getElementById("add-btn").click();
      await waitFor(() => sets > before, "storage.set for " + n);
      await sleep(300);
      perAction.push(sets - before);
    }
    const before = sets;
    [...doc.querySelectorAll("#user-links tr")]
      .find((r) => r.firstChild.textContent === "go/zzb")
      .querySelector("button").click();
    await waitFor(() => sets > before, "storage.set for delete");
    await sleep(300);
    perAction.push(sets - before);
    const { localLinks } = await browser.storage.sync.get("localLinks");
    return { perAction, keys: Object.keys(localLinks || {}).sort().join(",") };
  }
  throw new Error("unknown op " + cmd.op);
}

(async () => {
  const cmd = { op: new URLSearchParams(location.search).get("op") };
  let out;
  try {
    out = { ok: true, ...(await run(cmd)) };
  } catch (e) {
    out = { ok: false, error: String(e) };
  }
  location.hash = "result=" + Buffer_hex(JSON.stringify(out));
})();
