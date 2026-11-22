import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMON, load } from "./lib/sandbox.mjs";

const sb = () => load([...COMMON, "common/metrics.ts", "common/linksort.ts"]);
const run = (links, metrics, sort) =>
  JSON.parse(
    JSON.stringify(
      sb().get(`sortedNames(${JSON.stringify(links)}, ${JSON.stringify(metrics)}, ${JSON.stringify(sort)})`),
    ),
  );
const plain = (expr) => JSON.parse(JSON.stringify(sb().get(expr)));

const links = { b: "https://b.test", a: "https://z.test", c: "https://c.test" };
const stat = (count, lastHit, lastEdit) => ({ count, lastHit, lastEdit, recent: [], hourly: [], daily: [] });

test("the default sort is link A→Z", () => {
  assert.deepEqual(plain("DEFAULT_SORT"), { column: "link", dir: "asc" });
  assert.deepEqual(run(links, {}, plain("DEFAULT_SORT")), ["a", "b", "c"]);
});

test("link and destination sort as text, either direction", () => {
  assert.deepEqual(run(links, {}, { column: "link", dir: "desc" }), ["c", "b", "a"]);
  assert.deepEqual(run(links, {}, { column: "destination", dir: "asc" }), ["b", "c", "a"]);
  assert.deepEqual(run(links, {}, { column: "destination", dir: "desc" }), ["a", "c", "b"]);
});

test("text is case-insensitive and numeric-aware (a2 before a10)", () => {
  const l = { a10: "https://x", A2: "https://x", B1: "https://x", a1: "https://x" };
  assert.deepEqual(run(l, {}, { column: "link", dir: "asc" }), ["a1", "A2", "a10", "B1"]);
  const d = { x: "https://H.test", y: "https://g.test", z: "https://I.test" };
  assert.deepEqual(run(d, {}, { column: "destination", dir: "asc" }), ["y", "x", "z"]);
});

test("hits sort numerically; a link with no stat counts as 0; ties break by name A→Z", () => {
  const m = { a: stat(5), b: stat(20), c: stat(5) };
  assert.deepEqual(run(links, m, { column: "hits", dir: "desc" }), ["b", "a", "c"]);
  assert.deepEqual(run(links, m, { column: "hits", dir: "asc" }), ["a", "c", "b"]);
  assert.deepEqual(run(links, {}, { column: "hits", dir: "desc" }), ["a", "b", "c"]);
});

test("last hit and last edited: links without a value are last in both directions", () => {
  const m = { a: stat(1, 100, undefined), b: stat(1, undefined, 50), c: stat(1, 200, 70) };
  assert.deepEqual(run(links, m, { column: "lastHit", dir: "desc" }), ["c", "a", "b"]);
  assert.deepEqual(run(links, m, { column: "lastHit", dir: "asc" }), ["a", "c", "b"]);
  assert.deepEqual(run(links, m, { column: "lastEdit", dir: "desc" }), ["c", "b", "a"]);
  assert.deepEqual(run(links, m, { column: "lastEdit", dir: "asc" }), ["b", "c", "a"]);
  assert.deepEqual(run(links, {}, { column: "lastHit", dir: "asc" }), ["a", "b", "c"]);
  assert.deepEqual(run(links, {}, { column: "lastHit", dir: "desc" }), ["a", "b", "c"]);
});

test("the first click on a column: text A→Z, numbers and times highest/newest first", () => {
  for (const c of ["link", "destination"]) assert.equal(plain(`firstDirection("${c}")`), "asc");
  for (const c of ["hits", "lastHit", "lastEdit"]) assert.equal(plain(`firstDirection("${c}")`), "desc");
});

test("nextSort: the active column flips, a new one starts in its first direction", () => {
  assert.deepEqual(plain(`nextSort({column:"link",dir:"asc"}, "link")`), { column: "link", dir: "desc" });
  assert.deepEqual(plain(`nextSort({column:"hits",dir:"desc"}, "hits")`), { column: "hits", dir: "asc" });
  assert.deepEqual(plain(`nextSort({column:"link",dir:"asc"}, "hits")`), { column: "hits", dir: "desc" });
  assert.deepEqual(plain(`nextSort({column:"hits",dir:"asc"}, "destination")`), { column: "destination", dir: "asc" });
});

test("a stored sort that is missing or unknown falls back to the default", () => {
  const def = { column: "link", dir: "asc" };
  for (const bad of [undefined, null, "x", 3, {}, { column: "nope", dir: "asc" }, { column: "hits", dir: "up" }])
    assert.deepEqual(plain(`validSort(${JSON.stringify(bad) ?? "undefined"})`), def);
  assert.deepEqual(plain(`validSort({column:"hits",dir:"asc",extra:1})`), { column: "hits", dir: "asc" });
});
