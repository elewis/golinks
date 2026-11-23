// The two per-device data settings (storage.local): metricsEnabled (default on) and redirectLogEnabled (default off).
import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMON, load, putLinks } from "./lib/sandbox.mjs";

const FILES = [
  ...COMMON,
  "common/redirects.ts",
  "common/metrics.ts",
  "common/redirectlog.ts",
  "common/linksort.ts",
  "firefox/search.ts",
];
const plain = (v) => JSON.parse(JSON.stringify(v));
const tick = () => new Promise((r) => setTimeout(r, 10));
const logKeys = (fake) => Object.keys(fake.store.local).filter((k) => k.startsWith("redirectLog:"));

/** Started metrics and log; `redirect` feeds the browser's redirect listener, `change` fires a local storage change. */
function started(local = {}) {
  const s = load(FILES);
  Object.assign(s.fake.store.local, local);
  putLinks(s.fake, { gh: "https://github.com/" });
  s.get("startMetrics()");
  s.get("startRedirectLog()");
  const [[listener]] = s.fake.listeners.redirect;
  const redirect = async (url = "https://go/gh", to = "https://github.com/", requestId = "1") => {
    listener({ url, redirectUrl: to, requestId, tabId: 4 });
    await tick();
  };
  const change = async (key, newValue) => {
    s.fake.store.local[key] = newValue;
    if (newValue === undefined) delete s.fake.store.local[key];
    for (const f of s.fake.listeners.storageChanged) f({ [key]: { newValue } }, "local");
    await tick();
  };
  return { ...s, redirect, change };
}

test("defaults: a missing or odd value is metrics on, log off; only exact false / true switch", () => {
  const { get } = load(FILES);
  for (const v of ["undefined", "null", "0", '"false"', "true"]) assert.equal(get(`metricsEnabled(${v})`), true, v);
  assert.equal(get("metricsEnabled(false)"), false);
  for (const v of ["undefined", "null", "1", '"true"', "false"])
    assert.equal(get(`redirectLogEnabled(${v})`), false, v);
  assert.equal(get("redirectLogEnabled(true)"), true);
});

test("metrics: with nothing stored a hit is counted; the log writes nothing", async () => {
  const s = started();
  await s.redirect();
  assert.equal(s.fake.store.local.linkMetrics.gh.count, 1);
  assert.deepEqual(logKeys(s.fake), []);
});

test("metrics off: no hit and no lastEdit are recorded, existing stats are kept", async () => {
  const kept = { gh: { count: 3, lastHit: 5, recent: [], hourly: [], daily: [] } };
  const s = started({ metricsEnabled: false, linkMetrics: kept });
  await s.redirect();
  s.fake.store.sync["link:new"] = "https://new.test";
  for (const f of s.fake.listeners.storageChanged) f({ "link:new": { newValue: "https://new.test" } }, "sync");
  await tick();
  assert.deepEqual(plain(s.fake.store.local.linkMetrics), kept);
  await s.change("metricsEnabled", true);
  await s.redirect();
  assert.equal(s.fake.store.local.linkMetrics.gh.count, 4, "turning it on resumes from the kept data");
});

test("metrics: a write queued before the switch sees the new value (read inside the queue)", async () => {
  const s = started();
  const local = s.fake.api.storage.local;
  const get = local.get.bind(local);
  local.get = async (keys) => {
    const r = await get(keys);
    if (keys === "linkMetrics") await new Promise((res) => setTimeout(res, 20));
    return r;
  };
  s.redirect(); // task in flight: has read the setting as on
  await new Promise((res) => setTimeout(res, 5));
  s.fake.store.local.metricsEnabled = false;
  const late = s.redirect("https://go/gh", "https://github.com/", "2"); // read after the switch: dropped
  await late;
  await new Promise((res) => setTimeout(res, 40));
  assert.equal(s.fake.store.local.linkMetrics.gh.count, 1, "the in-flight hit may land, the later one does not");
});

test("log on: a navigation is logged; off again: nothing more is logged and the stored log is deleted", async () => {
  const s = started({ redirectLogEnabled: true });
  await s.redirect();
  assert.equal(logKeys(s.fake).length, 1);
  await s.change("redirectLogEnabled", false);
  assert.deepEqual(logKeys(s.fake), [], "turning it off deletes every day key");
  await s.redirect("https://go/gh", "https://github.com/", "2");
  assert.deepEqual(logKeys(s.fake), []);
});

test("log off at start: leftover redirectLog:* keys are deleted; other keys stay", async () => {
  const s = started({
    "redirectLog:2026-11-20": [{ at: 1 }],
    "redirectLog:2026-11-22": [{ at: 2 }],
    helpSort: { column: "hits", dir: "desc" },
  });
  await tick();
  assert.deepEqual(logKeys(s.fake), []);
  assert.ok(s.fake.store.local.helpSort);
});

test("log on at start: nothing is deleted", async () => {
  const s = started({ redirectLogEnabled: true, "redirectLog:2026-11-22": [{ at: 2 }] });
  await tick();
  assert.deepEqual(logKeys(s.fake), ["redirectLog:2026-11-22"]);
});

test("log: an append in flight when the log is turned off does not survive", async () => {
  const s = started({ redirectLogEnabled: true });
  const local = s.fake.api.storage.local;
  const set = local.set.bind(local);
  local.set = async (items) => {
    await new Promise((r) => setTimeout(r, 30)); // the write lands late
    await set(items);
  };
  s.redirect();
  await new Promise((r) => setTimeout(r, 5)); // the append has read the setting as on and is writing
  await s.change("redirectLogEnabled", false);
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(logKeys(s.fake), []);
});

test("search hand-off is memory only: with the log off the go/ hop stores nothing; with it on the entry keeps the search as from", async () => {
  const search = "https://www.google.com/search?q=go%2Fgh";
  const off = started();
  off.get(`noteSearchRedirect("r1", ${JSON.stringify(search)})`);
  await off.redirect("https://go/gh", "https://github.com/", "r1");
  assert.deepEqual(logKeys(off.fake), []);
  const on = started({ redirectLogEnabled: true });
  on.get(`noteSearchRedirect("r1", ${JSON.stringify(search)})`);
  await on.redirect("https://go/gh", "https://github.com/", "r1");
  const [key] = logKeys(on.fake);
  assert.equal(on.fake.store.local[key][0].from, search);
});

test("the settings are read from storage, not memory: a fresh start with log off deletes, with metrics off records nothing", async () => {
  const a = started({ metricsEnabled: false });
  await a.redirect();
  assert.equal(a.fake.store.local.linkMetrics, undefined);
});

test("factory reset removes both settings; Clear metrics keeps them", () => {
  const { get } = load(FILES);
  const stored = { linkMetrics: {}, metricsEnabled: false, redirectLogEnabled: true, "redirectLog:2026-11-22": [] };
  assert.deepEqual(plain(get(`metricsKeysToClear(${JSON.stringify(stored)})`)).sort(), [
    "linkMetrics",
    "redirectLog:2026-11-22",
  ]);
  assert.deepEqual(plain(get(`metricsKeysToClear(${JSON.stringify(stored)}, true)`)).sort(), [
    "linkMetrics",
    "metricsEnabled",
    "redirectLog:2026-11-22",
    "redirectLogEnabled",
  ]);
});

test("effectiveSort: a sort on a hidden usage column shows the default; a visible one is kept", () => {
  const { get } = load(FILES);
  const hits = { column: "hits", dir: "desc" };
  assert.deepEqual(plain(get(`effectiveSort(${JSON.stringify(hits)}, false)`)), { column: "link", dir: "asc" });
  assert.deepEqual(plain(get(`effectiveSort(${JSON.stringify(hits)}, true)`)), hits);
  const dest = { column: "destination", dir: "desc" };
  assert.deepEqual(plain(get(`effectiveSort(${JSON.stringify(dest)}, false)`)), dest);
});
