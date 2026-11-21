// Check 2: go/ URLs redirect, or render the extension's pages, as documented.
// Chrome matches the full https:// form (a bare go/github typed in the address
// bar is a search, which the extension cannot intercept).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startChrome } from "./lib/fixture.mjs";

let fx, page;
before(async () => {
  fx = await startChrome();
  page = await fx.chrome.newPage();
});
after(() => fx?.stop());

async function redirectsTo(url, prefix) {
  await fx.chrome.navigate(page, url);
  const final = await fx.chrome.waitUrl(page, (u) => u.startsWith(prefix));
  assert.ok(final.startsWith(prefix), `${url} -> ${final}, wanted ${prefix}*`);
}

async function rendersExtensionPage(url, name) {
  await fx.chrome.navigate(page, url);
  const want = `${fx.chrome.origin}/${name}`;
  const final = await fx.chrome.waitUrl(page, (u) => u.startsWith("chrome-extension://"));
  assert.equal(final, want, `${url} -> ${final}`);
}

describe("redirects", () => {
  test("static link: https://go/github", () => redirectsTo("https://go/github", "https://github.com/"));
  test("parameterised link: https://go/cs/test", () =>
    redirectsTo("https://go/cs/test", "https://github.com/search?q=test"));
  test("http scheme: http://go/gh", () => redirectsTo("http://go/gh", "https://github.com/"));
  test("names are case-insensitive: https://go/GH", () => redirectsTo("https://go/GH", "https://github.com/"));
  test("case-insensitive name, parameter keeps its case: https://go/CS/FooBar", () =>
    redirectsTo("https://go/CS/FooBar", "https://github.com/search?q=FooBar"));
  test("https://go/help renders index.html", () => rendersExtensionPage("https://go/help", "index.html"));
  test("https://go/ renders index.html", () => rendersExtensionPage("https://go/", "index.html"));
  test("unknown link renders notfound.html carrying its name", () =>
    rendersExtensionPage("https://go/nonexistent", "notfound.html?name=nonexistent"));
});
