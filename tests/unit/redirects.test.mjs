import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMON, load } from "./lib/sandbox.mjs";

const sb = () => load([...COMMON, "common/redirects.ts"]);
const plain = (v) => JSON.parse(JSON.stringify(v));

test("redirectFact: name, from, to, requestId, tabId and time of a go/ redirect", () => {
  const f = sb().get(
    `redirectFact({ url: "https://go/CS/a/b", redirectUrl: "https://x/?q=a/b", requestId: "r7", tabId: 4 }, 1234)`,
  );
  assert.deepEqual(plain(f), {
    name: "cs",
    from: "https://go/CS/a/b",
    to: "https://x/?q=a/b",
    requestId: "r7",
    tabId: 4,
    time: 1234,
  });
});

test("redirectFact: the bare root has an empty name; other hosts and bad URLs are no fact", () => {
  const { get } = sb();
  const d = (url) => `{ url: ${JSON.stringify(url)}, redirectUrl: "https://x/", requestId: "1", tabId: 1 }`;
  assert.equal(get(`redirectFact(${d("https://go/")}, 0).name`), "");
  assert.equal(get(`redirectFact(${d("https://example.com/go/x")}, 0)`), null);
  assert.equal(get(`redirectFact(${d("ftp://go/x")}, 0)`), null);
  assert.equal(get(`redirectFact(${d("nope")}, 0)`), null);
});

test("observeRedirects: one observe-only listener fans out to every consumer; a throwing one does not stop the rest", async () => {
  const { fake, get, logs } = sb();
  const seen = [];
  get("globalThis").seen = seen;
  get("observeRedirects(() => { throw new Error('boom'); })");
  get("observeRedirects((f) => seen.push(f.name))");
  assert.equal(fake.listeners.redirect.length, 1);
  const [[listener, filter, extra]] = fake.listeners.redirect;
  assert.deepEqual(plain(filter), { urls: ["http://go/*", "https://go/*"], types: ["main_frame"] });
  assert.equal(extra, undefined);
  listener({ url: "https://go/gh", redirectUrl: "https://github.com/", requestId: "1", tabId: 1 });
  listener({ url: "https://example.com/", redirectUrl: "https://github.com/", requestId: "2", tabId: 1 });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(seen, ["gh"]);
  assert.ok(logs.some((l) => l[0] === "error"));
});

const redirectOf = (extra) => ({
  url: "https://go/gh",
  redirectUrl: "https://github.com/",
  requestId: "1",
  tabId: 1,
  ...extra,
});
const settle = () => new Promise((r) => setTimeout(r, 0));

function seen(setup = () => {}) {
  const s = sb();
  setup(s.fake);
  const names = [];
  s.get("globalThis").names = names;
  s.get("observeRedirects((f) => names.push(f.name + ':' + f.requestId))");
  return { ...s, names, fire: (d) => s.fake.listeners.redirect[0][0](d) };
}

test("private: a Firefox request flagged incognito is no fact; a normal one is", async () => {
  const t = seen();
  t.fire(redirectOf({ requestId: "a", incognito: true }));
  t.fire(redirectOf({ requestId: "b", incognito: false }));
  await settle();
  assert.deepEqual(t.names, ["gh:b"]);
});

test("private: without an incognito field (Chrome) the tab decides", async () => {
  const t = seen((f) => Object.assign(f.tabs, { 1: false, 2: true }));
  t.fire(redirectOf({ requestId: "a", tabId: 2 }));
  t.fire(redirectOf({ requestId: "b", tabId: 1 }));
  await settle();
  assert.deepEqual(t.names, ["gh:b"]);
});

test("private: a failed tab lookup or no tab stores nothing (fail closed)", async () => {
  const t = seen((f) => Object.assign(f.tabs, { 99: null }));
  t.fire(redirectOf({ requestId: "a", tabId: 99 }));
  t.fire(redirectOf({ requestId: "b", tabId: -1 }));
  await settle();
  assert.deepEqual(t.names, []);
});

test("private: facts keep their order when tab lookups are slow", async () => {
  const t = seen((f) => Object.assign(f.tabs, { 1: false, 2: false }));
  t.fire(redirectOf({ requestId: "a", tabId: 1 }));
  t.fire(redirectOf({ requestId: "b", tabId: 2 }));
  await settle();
  assert.deepEqual(t.names, ["gh:a", "gh:b"]);
});
