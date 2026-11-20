import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMON, load } from "./lib/sandbox.mjs";

// The Firefox background script in the order its manifest lists the scripts.
const sb = () => load([...COMMON, "firefox/search.js", "firefox/background.js"]);

test("manifest lists the scripts in the order the sandbox loads them", async () => {
  const { readFile } = await import("node:fs/promises");
  const m = JSON.parse(await readFile(new URL("../../firefox/manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(m.background.scripts, ["api.js", "links.js", "rules.js", "search.js", "background.js"]);
});

test("the blocking listener watches main_frame on all URLs", () => {
  const [[, filter, extra]] = sb().fake.listeners.webRequest;
  assert.deepEqual(JSON.parse(JSON.stringify(filter)), { urls: ["<all_urls>"], types: ["main_frame"] });
  assert.deepEqual(JSON.parse(JSON.stringify(extra)), ["blocking"]);
});

test("the listener redirects a navigation without originUrl and records it", async () => {
  const { fake } = sb();
  const [[listener]] = fake.listeners.webRequest;
  const r = listener({ url: "https://www.google.com/search?q=go%2Fgithub", tabId: 3 });
  assert.deepEqual({ ...r }, { redirectUrl: "https://go/github" });
  await new Promise((res) => setTimeout(res, 0));
  assert.equal(fake.store.local.interceptions.length, 1);
});

test("the listener leaves page-originated and non-go/ requests alone and records nothing", async () => {
  const { fake } = sb();
  const [[listener]] = fake.listeners.webRequest;
  assert.equal(listener({ url: "https://g.com/?q=go/github", originUrl: "http://a.test/", tabId: 1 }), undefined);
  assert.equal(listener({ url: "https://github.com/golang/go/issues", tabId: 1 }), undefined);
  await new Promise((res) => setTimeout(res, 0));
  assert.equal(fake.store.local.interceptions, undefined);
});

test("startup builds the rules", async () => {
  const { fake } = sb();
  await new Promise((res) => setTimeout(res, 20));
  assert.ok(fake.rules().length > 3);
});
