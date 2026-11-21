import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMON, load } from "./lib/sandbox.mjs";

const sb = () => load([...COMMON, "firefox/search.ts"]);
const parse = (url) => sb().get(`goUrlFromSearch(${JSON.stringify(url)})`);

test("goUrlFromSearch: q, p, query and text on any host", () => {
  for (const url of [
    "https://www.google.com/search?q=go%2Fgithub",
    "https://www.google.co.uk/search?q=go/github",
    "https://search.yahoo.com/search?p=go/github",
    "https://example.org/find?query=go/github",
    "https://custom.engine/s?text=go/github",
    "http://localhost:8080/?q=go%2Fgithub",
  ])
    assert.equal(parse(url), "https://go/github", url);
});

test("goUrlFromSearch: keeps the path and arguments, trims, ignores case of go/", () => {
  assert.equal(parse("https://g.com/search?q=go/cs/test"), "https://go/cs/test");
  assert.equal(parse("https://g.com/search?q=%20go/gh%20"), "https://go/gh");
  assert.equal(parse("https://g.com/search?q=GO/gh"), "https://go/gh");
  assert.equal(parse("https://g.com/search?q=go/cs+two+words"), "https://go/cs%20two%20words");
});

test("goUrlFromSearch: only a query that starts with go/ and a link name matches", () => {
  for (const url of [
    "https://github.com/golang/go/issues",
    "https://foo.go/bar",
    "https://g.com/search?q=ago/github",
    "https://g.com/search?other=go/github",
    "https://g.com/search?q=go/",
    "https://g.com/search?q=go/%20x",
    "https://g.com/search?q=hello+go/github",
    "https://g.com/search",
    "ftp://g.com/?q=go/github",
    "not a url",
  ])
    assert.equal(parse(url), null, url);
});

const details = (n) => ({ url: `https://g.com/?q=go/x${n}`, tabId: n });

test("recordInterception: stores { at, from, to, tabId } in storage.local", async () => {
  const { fake, get, ctx } = sb();
  ctx.d = details(7);
  await get('recordInterception(d, "https://go/x7")');
  const [e] = fake.store.local.interceptions;
  assert.deepEqual(Object.keys(e).sort(), ["at", "from", "tabId", "to"]);
  assert.equal(e.from, "https://g.com/?q=go/x7");
  assert.equal(e.to, "https://go/x7");
  assert.equal(e.tabId, 7);
  assert.ok(!Number.isNaN(Date.parse(e.at)));
});

test("recordInterception: 150 overlapping records keep the last 100 in order", async () => {
  const { fake, get, ctx } = sb();
  const runs = [];
  for (let i = 0; i < 150; i++) {
    ctx.d = details(i);
    runs.push(get(`recordInterception(d, "https://go/x${i}")`));
  }
  await Promise.all(runs);
  const list = fake.store.local.interceptions;
  assert.equal(get("MAX_INTERCEPTIONS"), 100);
  assert.deepEqual(
    list.map((e) => e.tabId),
    Array.from({ length: 100 }, (_, i) => i + 50),
  );
});

test("recordInterception: a failing write is logged and does not block the next", async () => {
  const { fake, get, ctx, logs } = sb();
  const real = fake.api.storage.local.set;
  fake.api.storage.local.set = async () => {
    throw new Error("quota");
  };
  ctx.d = details(1);
  await get('recordInterception(d, "https://go/x1")');
  fake.api.storage.local.set = real;
  ctx.d = details(2);
  await get('recordInterception(d, "https://go/x2")');
  assert.deepEqual(
    fake.store.local.interceptions.map((e) => e.tabId),
    [2],
  );
  assert.ok(logs.some(([l]) => l === "error"));
});
