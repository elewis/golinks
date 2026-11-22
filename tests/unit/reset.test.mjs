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
  const stored = { linkMetrics: {}, "redirectLog:2026-11-22": [], deviceId: "x", helpSort: {} };
  const keys = JSON.parse(JSON.stringify(s.get(`metricsKeysToClear(${JSON.stringify(stored)}, true)`)));
  assert.deepEqual(keys.sort(), ["helpSort", "linkMetrics", "redirectLog:2026-11-22"]);
});

test("clearMetrics(true): removes metrics, log and helpSort, keeps deviceId", async () => {
  const s = sb();
  Object.assign(s.fake.store.local, {
    linkMetrics: {},
    "redirectLog:2026-11-22": [],
    deviceId: "id",
    helpSort: { column: "hits", dir: "desc" },
  });
  await s.get("clearMetrics(true)");
  assert.deepEqual(Object.keys(s.fake.store.local), ["deviceId"]);
});
