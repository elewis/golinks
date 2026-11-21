// Check 4: the webRequest listener only redirects genuine go/ navigations
// (an address-bar search for `go/...`), never an ordinary URL that merely
// contains "go/".
import assert from "node:assert/strict";
import { createServer } from "node:http";
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
  // about:blank: the load is still pending (host unreachable), so nothing redirected it either.
  assert.ok(
    final === url || final === "about:blank" || final.startsWith("about:neterror"),
    `${url} was redirected to ${final}`,
  );
}

describe("URLs that merely contain go/ are not redirected", () => {
  test("https://github.com/golang/go/issues", () => passesThrough("https://github.com/golang/go/issues"));
  test("https://example.com/?q=gox", () => passesThrough("https://example.com/?q=gox"));
  test("https://example.com/?q=ago/github", () => passesThrough("https://example.com/?q=ago/github"));
  test("https://example.com/?q=go/ (no link name)", () => passesThrough("https://example.com/?q=go%2F"));
  test("https://example.com/?other=go/github (not a search param)", () =>
    passesThrough("https://example.com/?other=go%2Fgithub"));
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
  test(
    "google: go/github",
    search("https://www.google.com/search?client=firefox-b-d&q=go%2Fgithub", "https://github.com/"),
  );
  test(
    "duckduckgo: go/cs/test",
    search("https://duckduckgo.com/?q=go%2Fcs%2Ftest&t=ffab", "https://github.com/search?q=test"),
  );
  // Any host: regional Google, custom engines, anything that takes the text in q/p/query/text.
  test("regional google: go/github", search("https://www.google.co.uk/search?q=go%2Fgithub", "https://github.com/"));
  test(
    "custom engine on any host: go/github",
    search("https://example.com/search?q=go%2Fgithub", "https://github.com/"),
  );
  test("custom engine, param p: go/gh", search("https://search.example.org/?p=go%2Fgh", "https://github.com/"));
  test("custom engine, param query: go/gh", search("https://search.example.org/?query=go%2Fgh", "https://github.com/"));
  test("custom engine, param text: go/gh", search("https://search.example.org/?text=go%2Fgh", "https://github.com/"));
  test(
    "bing: go/gh with a plus-encoded space",
    search("https://www.bing.com/search?q=go%2Fgh+&form=x", "https://github.com/"),
  );
});

// An address-bar navigation has no originUrl; a link click or form submit from
// a page has one. Only the former is a typed `go/x`. The page must have a real
// origin (a data: page has none, so Firefox reports no originUrl for it), hence
// a throwaway local HTTP server.
describe("a link or form in a page is not an address-bar search", () => {
  let srv;
  const html = `<a id=a href="https://example.com/?q=go%2Fgithub">x</a>
    <form action="https://example.com/" method=get><input name=q value="go/github"><button id=b>x</button></form>`;
  before(async () => {
    srv = createServer((_, res) => res.setHeader("content-type", "text/html").end(html));
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  });
  after(() => srv?.close());

  async function fromPage(selector) {
    const page = `http://127.0.0.1:${srv.address().port}/`;
    await fx.ff.get(page);
    await fx.ff.waitUrl((u) => u === page);
    await fx.ff.click(selector);
    return fx.ff.waitUrl((u) => u !== page, 4000);
  }
  test("clicking a link to example.com/?q=go/github", async () => {
    const final = await fromPage("#a");
    assert.ok(
      final.startsWith("https://example.com/") || final.startsWith("about:neterror"),
      `link click was redirected to ${final}`,
    );
  });
  test("submitting a GET form to example.com with q=go/github", async () => {
    const final = await fromPage("#b");
    assert.ok(
      final.startsWith("https://example.com/") || final.startsWith("about:neterror"),
      `form submit was redirected to ${final}`,
    );
  });
});
