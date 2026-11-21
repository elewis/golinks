// Check 2: go/ URLs redirect, or render the extension's pages, as documented.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startFirefox } from "./lib/fixture.mjs";

let fx;
before(async () => (fx = await startFirefox()));
after(() => fx?.stop());

// Start each navigation from a blank page so a stale URL from the previous
// test can never satisfy the wait.
async function navigate(url) {
  await fx.ff.get("about:blank");
  await fx.ff.waitUrl((u) => u === "about:blank");
  await fx.ff.get(url);
}

async function redirectsTo(url, prefix) {
  await navigate(url);
  const final = await fx.ff.waitUrl((u) => u.startsWith(prefix));
  assert.ok(final.startsWith(prefix), `${url} -> ${final}, wanted ${prefix}*`);
}

async function rendersExtensionPage(url, page) {
  await navigate(url);
  const final = await fx.ff.waitUrl((u) => u.startsWith("moz-extension://"));
  assert.ok(
    final.startsWith("moz-extension://") && final.endsWith(`/${page}`),
    `${url} -> ${final}, wanted moz-extension://.../${page}`,
  );
}

describe("redirects", () => {
  test("static link: https://go/github", () => redirectsTo("https://go/github", "https://github.com/"));
  test("parameterised link: https://go/cs/test", () =>
    redirectsTo("https://go/cs/test", "https://github.com/search?q=test"));
  test("http scheme: http://go/gh", () => redirectsTo("http://go/gh", "https://github.com/"));
  test("https://go/help renders index.html", () => rendersExtensionPage("https://go/help", "index.html"));
  test("https://go/ renders index.html", () => rendersExtensionPage("https://go/", "index.html"));
  test("unknown link renders notfound.html carrying its name", () =>
    rendersExtensionPage("https://go/nonexistent", "notfound.html?name=nonexistent"));
});
