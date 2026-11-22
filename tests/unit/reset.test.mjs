import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMON, load, putLinks, linksIn } from "./lib/sandbox.mjs";

const sb = () => load([...COMMON, "common/redirects.ts", "common/redirectlog.ts"]);

test("resetPlan: removes every link:* item, writes the shipped links and their seeded markers", () => {
  const s = sb();
  const stored = { "link:mine": "https://m.test", "link:gh": "https://other.test", "seeded:gh": true, other: 1 };
  const plan = JSON.parse(JSON.stringify(s.get(`resetLinksPlan(${JSON.stringify(stored)})`)));
  assert.deepEqual(plan.remove.sort(), ["link:gh", "link:mine"]);
  const shipped = JSON.parse(JSON.stringify(s.get("SHIPPED_LINKS")));
  const expected = {};
  for (const [n, u] of Object.entries(shipped)) {
    expected[`link:${n}`] = u;
    expected[`seeded:${n}`] = true;
  }
  assert.deepEqual(plan.set, expected);
});

test("resetLinks: afterwards the links are exactly the shipped ones and seeding has nothing to do", async () => {
  const s = sb();
  putLinks(s.fake, { mine: "https://m.test", gh: "https://other.test" });
  s.fake.store.sync["seeded:gg"] = true; // gg deleted earlier: a reset brings it back
  s.fake.store.sync.unrelated = "keep";
  await s.get("resetLinks()");
  assert.deepEqual(linksIn(s.fake), JSON.parse(JSON.stringify(s.get("SHIPPED_LINKS"))));
  assert.equal(s.fake.store.sync.unrelated, "keep");
  const before = JSON.stringify(s.fake.store.sync);
  await s.get("seedDefaults()");
  assert.equal(JSON.stringify(s.fake.store.sync), before);
});

test("resetLinks: one remove and one set, no whole-list write", async () => {
  const s = sb();
  putLinks(s.fake, { mine: "https://m.test" });
  const calls = [];
  for (const m of ["set", "remove"]) {
    const orig = s.fake.api.storage.sync[m];
    s.fake.api.storage.sync[m] = (a) => (calls.push(m), orig(a));
  }
  await s.get("resetLinks()");
  assert.deepEqual(calls.sort(), ["remove", "set"]);
});

test("metricsKeysToClear: linkMetrics and every redirectLog:* key, nothing else", () => {
  const s = sb();
  const stored = {
    linkMetrics: {},
    "redirectLog:2026-11-20": [],
    "redirectLog:2026-11-22": [],
    deviceId: "x",
    helpSort: {},
  };
  const keys = JSON.parse(JSON.stringify(s.get(`metricsKeysToClear(${JSON.stringify(stored)})`)));
  assert.deepEqual(keys.sort(), ["linkMetrics", "redirectLog:2026-11-20", "redirectLog:2026-11-22"]);
});

test("clearMetrics: keeps deviceId, helpSort and the links", async () => {
  const s = sb();
  putLinks(s.fake, { a: "https://a.test" });
  Object.assign(s.fake.store.local, {
    linkMetrics: { a: { count: 3 } },
    "redirectLog:2026-11-22": [{ at: 1 }],
    deviceId: "id",
    helpSort: { column: "hits", dir: "desc" },
  });
  await s.get("clearMetrics()");
  assert.deepEqual(Object.keys(s.fake.store.local).sort(), ["deviceId", "helpSort"]);
  assert.deepEqual(linksIn(s.fake), { a: "https://a.test" });
});

test("metricsKeysToClear with settings (the factory reset) also takes helpSort, never deviceId", () => {
  const s = sb();
  const stored = { linkMetrics: {}, "redirectLog:2026-11-22": [], deviceId: "x", helpSort: {}, appearance: "dark" };
  const keys = JSON.parse(JSON.stringify(s.get(`metricsKeysToClear(${JSON.stringify(stored)}, true)`)));
  assert.deepEqual(keys.sort(), ["appearance", "helpSort", "linkMetrics", "redirectLog:2026-11-22"]);
});

test("clearMetrics(true): removes metrics, log, helpSort and appearance, keeps deviceId", async () => {
  const s = sb();
  Object.assign(s.fake.store.local, {
    linkMetrics: {},
    "redirectLog:2026-11-22": [],
    deviceId: "id",
    helpSort: { column: "hits", dir: "desc" },
    appearance: "dark",
  });
  await s.get("clearMetrics(true)");
  assert.deepEqual(Object.keys(s.fake.store.local), ["deviceId"]);
});

// The background's edit listener records `lastEdit` for the links the reset writes: read linkMetrics, write it back.
// If the page's local clear came after the links were written, a slow read of that task could write the old stats
// back. The fake fires the storage listeners on sync writes and delays the metrics read's result by a macrotask.
test("factoryReset: clears this device first, so the edit listener's metrics write cannot bring old stats back", async () => {
  const s = load([...COMMON, "common/redirects.ts", "common/metrics.ts", "common/redirectlog.ts"]);
  const { fake } = s;
  const fire = (changes) => {
    for (const f of fake.listeners.storageChanged) f(changes, "sync");
  };
  const syncArea = fake.api.storage.sync;
  const set = syncArea.set.bind(syncArea);
  const remove = syncArea.remove.bind(syncArea);
  syncArea.set = async (items) => {
    const before = structuredClone(fake.store.sync);
    await set(items);
    fire(Object.fromEntries(Object.keys(items).map((k) => [k, { oldValue: before[k], newValue: items[k] }])));
  };
  syncArea.remove = async (keys) => {
    const before = structuredClone(fake.store.sync);
    await remove(keys);
    fire(Object.fromEntries([keys].flat().map((k) => [k, { oldValue: before[k] }])));
  };
  const localArea = fake.api.storage.local;
  const get = localArea.get.bind(localArea);
  localArea.get = async (keys) => {
    const result = await get(keys);
    if (keys === "linkMetrics") await new Promise((r) => setTimeout(r, 5)); // a slow read: a stale snapshot
    return result;
  };
  s.get("startMetrics()");
  putLinks(fake, { zzmine: "https://example.com/mine" });
  Object.assign(fake.store.local, {
    linkMetrics: { zzmine: { count: 5, lastHit: 1, lastEdit: 1, recent: [], hourly: [], daily: [] } },
    "redirectLog:2026-11-20": [{ at: 1 }],
    helpSort: { column: "hits", dir: "desc" },
    appearance: "dark",
  });

  await s.get("factoryReset()");
  await new Promise((r) => setTimeout(r, 50)); // the metrics queue settles
  await s.get("metricsQueue");

  const metrics = fake.store.local.linkMetrics ?? {};
  assert.equal(metrics.zzmine, undefined, "the old stats stay cleared");
  assert.ok(metrics.gh?.lastEdit, "a re-added default only has its lastEdit");
  assert.equal(metrics.gh?.count, 0);
  assert.deepEqual(Object.keys(fake.store.local).sort(), ["deviceId", "linkMetrics"]);
  assert.deepEqual(linksIn(fake), JSON.parse(JSON.stringify(s.get("SHIPPED_LINKS"))));
});
