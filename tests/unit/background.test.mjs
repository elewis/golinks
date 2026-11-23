import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMON, load } from "./lib/sandbox.mjs";

// The Firefox background script in the order its manifest lists the scripts.
const sb = () =>
  load([
    ...COMMON,
    "common/redirects.ts",
    "common/metrics.ts",
    "common/redirectlog.ts",
    "firefox/search.ts",
    "firefox/background.ts",
  ]);

test("manifest lists the scripts in the order the sandbox loads them", async () => {
  const { readFile } = await import("node:fs/promises");
  const m = JSON.parse(await readFile(new URL("../../firefox/manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(m.background.scripts, [
    "api.js",
    "links.js",
    "rules.js",
    "redirects.js",
    "metrics.js",
    "redirectlog.js",
    "search.js",
    "background.js",
  ]);
});

test("the blocking listener watches main_frame on all URLs", () => {
  const [[, filter, extra]] = sb().fake.listeners.webRequest;
  assert.deepEqual(JSON.parse(JSON.stringify(filter)), { urls: ["<all_urls>"], types: ["main_frame"] });
  assert.deepEqual(JSON.parse(JSON.stringify(extra)), ["blocking"]);
});

test("the listener redirects a navigation without originUrl; the search becomes the entry's from", async () => {
  const { fake } = sb();
  const [[listener]] = fake.listeners.webRequest;
  const search = "https://www.google.com/search?q=go%2Fgithub";
  const r = listener({ url: search, tabId: 3, requestId: "r1" });
  assert.deepEqual({ ...r }, { redirectUrl: "https://go/github" });
  // Nothing is logged by the interception itself.
  await new Promise((res) => setTimeout(res, 0));
  assert.deepEqual(
    Object.keys(fake.store.local).filter((k) => k.startsWith("redirectLog")),
    [],
  );
  // The go/ hop that follows logs one entry whose from is the search.
  const [[onRedirect]] = fake.listeners.redirect;
  onRedirect({ url: "https://go/github", redirectUrl: "https://github.com/", requestId: "r1", tabId: 3 });
  await new Promise((res) => setTimeout(res, 0));
  const [key] = Object.keys(fake.store.local).filter((k) => k.startsWith("redirectLog:"));
  assert.equal(fake.store.local[key].length, 1);
  assert.equal(fake.store.local[key][0].from, search);
});

test("the listener leaves page-originated and non-go/ requests alone and logs nothing", async () => {
  const { fake } = sb();
  const [[listener]] = fake.listeners.webRequest;
  assert.equal(listener({ url: "https://g.com/?q=go/github", originUrl: "http://a.test/", tabId: 1 }), undefined);
  assert.equal(listener({ url: "https://github.com/golang/go/issues", tabId: 1 }), undefined);
  await new Promise((res) => setTimeout(res, 0));
  assert.deepEqual(
    Object.keys(fake.store.local).filter((k) => k.startsWith("redirectLog")),
    [],
  );
});

test("startup builds the rules", async () => {
  const { fake } = sb();
  await new Promise((res) => setTimeout(res, 20));
  assert.ok(fake.rules().length > 3);
});

test("a private-window search is still redirected, but nothing of it is stored", async () => {
  const { fake, get } = sb();
  const [[listener]] = fake.listeners.webRequest;
  const search = "https://www.google.com/search?q=go%2Fgithub";
  const r = listener({ url: search, tabId: 3, requestId: "p1", incognito: true });
  assert.deepEqual({ ...r }, { redirectUrl: "https://go/github" });
  assert.equal(get("redirectPending.size"), 0);
  const [[onRedirect]] = fake.listeners.redirect;
  onRedirect({
    url: "https://go/github",
    redirectUrl: "https://github.com/",
    requestId: "p1",
    tabId: 3,
    incognito: true,
  });
  await new Promise((res) => setTimeout(res, 0));
  assert.deepEqual(
    Object.keys(fake.store.local).filter((k) => k.startsWith("redirectLog") || k === "linkMetrics"),
    [],
  );
});
