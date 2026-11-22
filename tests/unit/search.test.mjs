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
