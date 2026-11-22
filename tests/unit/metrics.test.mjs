import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMON, load } from "./lib/sandbox.mjs";

const sb = () => load([...COMMON, "common/redirects.ts", "common/metrics.ts"]);
const plain = (v) => JSON.parse(JSON.stringify(v));
const DAY = 86400;
const NOW = 1_800_000_000; // a multiple of 3600 and of 86400? only used relatively
// The listener hands the fact to its consumers, which read the links first: let that finish.
const fire = async (listener, details) => {
  listener({ requestId: "1", tabId: 1, ...details });
  await tick();
};
const tick = () => new Promise((r) => setTimeout(r, 5));

test("hitName: a saved link counts under its lowercase name", () => {
  const { get } = sb();
  const links = { gh: "https://github.com", cs: "https://x/?q=%s" };
  const name = (url, to = "https://github.com/") =>
    get(
      `hitName(redirectFact({ url: ${JSON.stringify(url)}, redirectUrl: ${JSON.stringify(to)}, requestId: "1", tabId: 1 }, 0) ?? { name: "", to: "" }, ${JSON.stringify(links)}, "chrome-extension://fake-id/")`,
    );
  assert.equal(name("https://go/gh"), "gh");
  assert.equal(name("http://go/GH"), "gh");
  assert.equal(name("https://go/cs/FooBar", "https://x/?q=FooBar"), "cs");
});

test("hitName: unknown names, help, root, not-found redirects and other hosts do not count", () => {
  const { get } = sb();
  const links = { gh: "https://github.com" };
  const name = (url, to) =>
    get(
      `hitName(redirectFact({ url: ${JSON.stringify(url)}, redirectUrl: ${JSON.stringify(to)}, requestId: "1", tabId: 1 }, 0) ?? { name: "", to: "" }, ${JSON.stringify(links)}, "chrome-extension://fake-id/")`,
    );
  assert.equal(name("https://go/zz", "https://x/"), null);
  assert.equal(name("https://go/help", "chrome-extension://fake-id/index.html"), null);
  assert.equal(name("https://go/", "chrome-extension://fake-id/index.html"), null);
  // a saved name whose redirect goes to the extension's own page is no hit
  assert.equal(name("https://go/gh", "chrome-extension://fake-id/notfound.html?name=gh"), null);
  assert.equal(name("https://other/gh", "https://github.com/"), null);
  assert.equal(name("https://go/toString", "https://x/"), null);
  assert.equal(name("not a url", "https://x/"), null);
});

test("withHit: counts, sets lastHit, keeps a per-second entry", () => {
  const { get } = sb();
  const m = plain(get(`withHit(withHit({}, "gh", ${NOW}), "gh", ${NOW + 1})`));
  assert.deepEqual(m.gh, {
    count: 2,
    lastHit: NOW + 1,
    recent: [{ at: NOW }, { at: NOW + 1 }],
    hourly: [],
    daily: [],
  });
});

test("rollup: a hit just inside 7 days stays per-second, just outside becomes an hourly bucket", () => {
  const { get } = sb();
  const t0 = 1_700_000_000;
  const hour = t0 - (t0 % 3600);
  const m = `withHit({}, "gh", ${t0})`;
  // 7 days later to the second: still recent
  let s = plain(get(`withHit(${m}, "gh", ${t0 + 7 * DAY})`)).gh;
  assert.equal(s.recent.length, 2);
  assert.deepEqual(s.hourly, []);
  // one second later: the first hit is rolled into its hour
  s = plain(get(`withHit(${m}, "gh", ${t0 + 7 * DAY + 1})`)).gh;
  assert.deepEqual(s.recent, [{ at: t0 + 7 * DAY + 1 }]);
  assert.deepEqual(s.hourly, [{ at: hour, n: 1 }]);
  assert.equal(s.count, 2);
});

test("rollup: hits of one hour share a bucket; an hour older than 90 days becomes a daily bucket", () => {
  const { get } = sb();
  const t0 = 1_700_000_000;
  const hour = t0 - (t0 % 3600);
  const day = t0 - (t0 % DAY);
  const m = `withHit(withHit({}, "gh", ${t0}), "gh", ${t0 + 5})`; // same hour (t0 % 3600 <= 3594)
  let s = plain(get(`withHit(${m}, "gh", ${t0 + 8 * DAY})`)).gh;
  assert.deepEqual(s.hourly, [{ at: hour, n: 2 }]);
  // the hour starts before now - 90 days: daily
  const later = hour + 90 * DAY + 1;
  s = plain(get(`withHit(withHit(${m}, "gh", ${t0 + 8 * DAY}), "gh", ${later})`)).gh;
  assert.ok(!s.hourly.some((b) => b.at === hour));
  assert.deepEqual(s.daily, [{ at: day, n: 2 }]);
  assert.equal(s.count, 4);
  // exactly 90 days: the hour stays hourly
  s = plain(get(`withHit(withHit(${m}, "gh", ${t0 + 8 * DAY}), "gh", ${hour + 90 * DAY})`)).gh;
  assert.deepEqual(s.hourly[0], { at: hour, n: 2 });
  assert.deepEqual(s.daily, []);
});

test("withEdit sets lastEdit and keeps the stats", () => {
  const { get } = sb();
  const m = plain(get(`withEdit(withHit({}, "gh", ${NOW}), "gh", ${NOW + 9})`));
  assert.equal(m.gh.lastEdit, NOW + 9);
  assert.equal(m.gh.count, 1);
});

test("editedNames: added and changed destinations, not removals or the same value; any key case", () => {
  const { get } = sb();
  const e = (a, b) => plain(get(`editedNames(${JSON.stringify(a)}, ${JSON.stringify(b)})`)).sort();
  assert.deepEqual(e(undefined, { a: "https://1" }), ["a"]);
  assert.deepEqual(e({ a: "https://1" }, { a: "https://2", b: "https://3" }), ["a", "b"]);
  assert.deepEqual(e({ a: "https://1", b: "https://2" }, { a: "https://1" }), []);
  assert.deepEqual(e({ A: "https://1" }, { a: "https://1" }), []);
  assert.deepEqual(e({ a: "https://1" }, undefined), []);
});

test("format helpers: never and — for missing values, hits as a number", () => {
  const { get } = sb();
  assert.equal(get("formatHits(undefined)"), "0");
  assert.equal(get("formatLastHit(undefined)"), "never");
  assert.equal(get("formatLastEdit({count: 1, recent: [], hourly: [], daily: []})"), "—");
  assert.equal(get("formatHits({count: 7, lastHit: 5, recent: [], hourly: [], daily: []})"), "7");
  assert.match(
    get("formatLastHit({count: 1, lastHit: 1700000000, recent: [], hourly: [], daily: []})"),
    /\d{2}:\d{2}:\d{2}/,
  );
});

test("startMetrics: the redirect listener is observe-only and filtered to go/ main_frame", () => {
  const { fake, get } = sb();
  get("startMetrics()");
  const [[, filter, extra]] = fake.listeners.redirect;
  assert.deepEqual(plain(filter), { urls: ["http://go/*", "https://go/*"], types: ["main_frame"] });
  assert.equal(extra, undefined);
});

test("a redirect from a saved link is a hit; unknown and not-found are not", async () => {
  const { fake, get } = sb();
  get("startMetrics()");
  const [[listener]] = fake.listeners.redirect;
  await fire(listener, { url: "https://go/github", redirectUrl: "https://github.com/" });
  await fire(listener, { url: "https://go/zz", redirectUrl: "chrome-extension://fake-id/notfound.html?name=zz" });
  await fire(listener, { url: "https://go/help", redirectUrl: "chrome-extension://fake-id/index.html" });
  await tick();
  assert.deepEqual(Object.keys(fake.store.local.linkMetrics), ["github"]);
  assert.equal(fake.store.local.linkMetrics.github.count, 1);
});

test("a burst of 100 overlapping hits loses none", async () => {
  const { fake, get } = sb();
  get("startMetrics()");
  const [[listener]] = fake.listeners.redirect;
  await Promise.all(
    Array.from({ length: 100 }, () => listener({ url: "https://go/gh", redirectUrl: "https://github.com/" })),
  );
  await tick();
  await get("metricsQueue");
  assert.equal(fake.store.local.linkMetrics.gh.count, 100);
  assert.equal(fake.store.local.linkMetrics.gh.recent.length, 100);
});

test("a changed localLinks sets lastEdit, once per changed name; defaults and removals do not", async () => {
  const { fake, get } = sb();
  get("startMetrics()");
  const emit = (changes, area) => {
    for (const f of fake.listeners.storageChanged) f(changes, area);
  };
  const change = (oldValue, newValue) => emit({ localLinks: { oldValue, newValue } }, "sync");
  change(undefined, { mine: "https://example.com/1" });
  await get("metricsQueue");
  const first = fake.store.local.linkMetrics.mine.lastEdit;
  assert.equal(typeof first, "number");
  change({ mine: "https://example.com/1" }, {});
  emit({ defaultLinks: { newValue: { x: "https://x" } } }, "sync");
  emit({ localLinks: { newValue: { y: "https://y" } } }, "local");
  await get("metricsQueue");
  assert.deepEqual(Object.keys(fake.store.local.linkMetrics), ["mine"]);
});

test("a failing write is logged and does not block the next", async () => {
  const { fake, get, logs } = sb();
  let fail = true;
  const set = fake.api.storage.local.set;
  fake.api.storage.local.set = async (v) => {
    if (fail && "linkMetrics" in v) {
      fail = false;
      throw new Error("quota");
    }
    return set(v);
  };
  get("startMetrics()");
  const [[listener]] = fake.listeners.redirect;
  await fire(listener, { url: "https://go/gh", redirectUrl: "https://github.com/" });
  await fire(listener, { url: "https://go/gh", redirectUrl: "https://github.com/" });
  await get("metricsQueue");
  assert.equal(fake.store.local.linkMetrics.gh.count, 1);
  assert.ok(logs.some((l) => l[0] === "error"));
});

test("hitName: a scheme upgrade (http://go/gh -> https://go/gh) is no hit; a link to a different go/ name is", () => {
  const { get } = sb();
  const links = { gh: "https://github.com", other: "https://go/gh" };
  const name = (url, to) =>
    get(
      `hitName(redirectFact({ url: ${JSON.stringify(url)}, redirectUrl: ${JSON.stringify(to)}, requestId: "1", tabId: 1 }, 0), ${JSON.stringify(links)}, "chrome-extension://fake-id/")`,
    );
  assert.equal(name("http://go/gh", "https://go/gh"), null);
  assert.equal(name("http://go/GH", "https://go/gh/"), null);
  assert.equal(name("http://go/gh", "https://github.com/"), "gh");
  assert.equal(name("https://go/other", "https://go/gh"), "other");
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("getDeviceId creates a UUID once, keeps it in storage.local.deviceId and returns the same one after", async () => {
  const { fake, get } = sb();
  const id = await get("getDeviceId()");
  assert.match(id, UUID);
  assert.equal(fake.store.local.deviceId, id);
  assert.equal(await get("getDeviceId()"), id);
  assert.equal(fake.store.local.linkMetrics, undefined);
});

test("getDeviceId keeps an id already in storage, also in a fresh context", async () => {
  const fake = (await import("./lib/sandbox.mjs")).fakeApi();
  fake.store.local.deviceId = "existing-id";
  const { get } = load([...COMMON, "common/redirects.ts", "common/metrics.ts"], fake);
  assert.equal(await get("getDeviceId()"), "existing-id");
  assert.equal(fake.store.local.deviceId, "existing-id");
});

test("getDeviceId replaces an unusable stored value", async () => {
  const fake = (await import("./lib/sandbox.mjs")).fakeApi();
  fake.store.local.deviceId = "";
  const { get } = load([...COMMON, "common/redirects.ts", "common/metrics.ts"], fake);
  assert.match(await get("getDeviceId()"), UUID);
});

test("a burst of concurrent first calls makes one id and one write", async () => {
  const { fake, get } = sb();
  let writes = 0;
  const set = fake.api.storage.local.set;
  fake.api.storage.local.set = async (v) => {
    if ("deviceId" in v) writes++;
    return set(v);
  };
  const ids = await Promise.all(Array.from({ length: 50 }, () => get("getDeviceId()")));
  assert.equal(new Set(ids).size, 1);
  assert.equal(writes, 1);
  assert.equal(fake.store.local.deviceId, ids[0]);
});

test("a failed first write is not cached: the next call tries again", async () => {
  const { fake, get } = sb();
  let fail = true;
  const set = fake.api.storage.local.set;
  fake.api.storage.local.set = async (v) => {
    if (fail) {
      fail = false;
      throw new Error("quota");
    }
    return set(v);
  };
  await assert.rejects(get("getDeviceId()"), /quota/);
  assert.match(await get("getDeviceId()"), UUID);
});

test("startMetrics creates the device id, and a hit does not change it", async () => {
  const { fake, get } = sb();
  get("startMetrics()");
  await tick();
  const id = fake.store.local.deviceId;
  assert.match(id, UUID);
  const [[listener]] = fake.listeners.redirect;
  await fire(listener, { url: "https://go/github", redirectUrl: "https://github.com/" });
  await get("metricsQueue");
  assert.equal(fake.store.local.deviceId, id);
  assert.deepEqual(Object.keys(fake.store.local.linkMetrics), ["github"]);
});
