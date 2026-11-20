// Check 4: the webRequest listener only redirects genuine go/ navigations
// (an address-bar search for `go/...`), never an ordinary URL that merely
// contains "go/".
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startFirefox } from "./lib/fixture.mjs";

let fx;
before(async () => (fx = await startFirefox()));
after(() => fx?.stop());

async function navigate(url) {
  await fx.ff.get("about:blank");
  await fx.ff.waitUrl((u) => u === "about:blank");
  await fx.ff.get(url);
}

async function passesThrough(url) {
  await navigate(url);
  // Any change of URL to another page (go/, an extension page, a link target) is
  // a hijack. about:neterror is just the browser failing to load the original.
  const final = await fx.ff.waitUrl((u) => u !== url && u !== "about:blank" && !u.startsWith("about:neterror"), 4000);
  assert.ok(final === url || final.startsWith("about:neterror"), `${url} was redirected to ${final}`);
}

describe("URLs that merely contain go/ are not redirected", () => {
  test("https://github.com/golang/go/issues", () => passesThrough("https://github.com/golang/go/issues"));
  test("https://example.com/?q=go/x", () => passesThrough("https://example.com/?q=go/x"));
  test("https://example.com/?q=go%2Fgithub", () => passesThrough("https://example.com/?q=go%2Fgithub"));
  test("https://foo.go/bar", () => passesThrough("https://foo.go/bar"));
  test("https://example.com/go/github", () => passesThrough("https://example.com/go/github"));
});

describe("an address-bar search for go/... is redirected", () => {
  // What Firefox sends when `go/github` is typed and the default search engine takes it.
  const search = (u, prefix) => async () => {
    await navigate(u);
    const final = await fx.ff.waitUrl((x) => x.startsWith(prefix));
    assert.ok(final.startsWith(prefix), `${u} -> ${final}, wanted ${prefix}*`);
  };
  test("google: go/github", search("https://www.google.com/search?client=firefox-b-d&q=go%2Fgithub", "https://github.com/"));
  test("duckduckgo: go/cs/test", search("https://duckduckgo.com/?q=go%2Fcs%2Ftest&t=ffab", "https://github.com/search?q=test"));
  test("bing: go/gh with a plus-encoded space", search("https://www.bing.com/search?q=go%2Fgh+&form=x", "https://github.com/"));
});
