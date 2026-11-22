import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMON, load } from "./lib/sandbox.mjs";

const sb = () => load([...COMMON, "common/linkform.ts"]);
const plain = (v) => JSON.parse(JSON.stringify(v));
const check = (name, url, links = {}) =>
  plain(sb().get(`checkLink(${JSON.stringify(name)}, ${JSON.stringify(url)}, ${JSON.stringify(links)})`));

test("checkLink: a valid name and URL are accepted, trimmed, with a leading go/ dropped", () => {
  assert.deepEqual(check("  go/docs ", " https://example.com/docs "), {
    ok: true,
    name: "docs",
    url: "https://example.com/docs",
  });
  assert.deepEqual(check("docs", "https://x.test"), { ok: true, name: "docs", url: "https://x.test" });
});

test("checkLink: an empty name or URL is an error shown on that field", () => {
  assert.ok(check("", "https://x.test").errors.name);
  assert.ok(check("   ", "https://x.test").errors.name);
  assert.ok(check("go/", "https://x.test").errors.name);
  assert.ok(check("docs", "").errors.url);
  assert.ok(check("docs", "  ").errors.url);
  const both = check("", "");
  assert.ok(both.errors.name && both.errors.url);
  assert.equal(both.ok, false);
});

test("checkLink: the URL must be a full http(s) URL", () => {
  const bad = [
    "foo bar",
    "https://x.test/a b",
    "javascript:alert(1)",
    "ftp://x.test/f",
    "https://",
    "//x.test",
    "mailto:a@b.c",
    "file:///etc/passwd",
  ];
  for (const url of bad) assert.equal(check("ok", url).ok, false, url);
  for (const url of ["ftp://x.test/f", "file:///etc/passwd"]) {
    assert.match(check("ok", url).errors.url, /http:\/\/ or https:\/\//, url);
  }
  for (const url of [
    "http://x.test",
    "https://x.test/a?b=c#d",
    "HTTPS://X.TEST",
    "https://github.com/search?q=%s",
    "https://x.test/%s/more",
  ]) {
    assert.equal(check("ok", url).ok, true, url);
  }
});

test("checkLink: a URL without a scheme is saved with https://", () => {
  const saved = (url) => check("ok", url).url;
  assert.equal(saved("example.com"), "https://example.com");
  assert.equal(saved("  docs.example.com/x/y?q=1#h "), "https://docs.example.com/x/y?q=1#h");
  assert.equal(saved("github.com/search?q=%s"), "https://github.com/search?q=%s");
  assert.equal(saved("localhost:8080/a"), "http://localhost:8080/a");
  assert.equal(saved("http://x.test"), "http://x.test");
  assert.equal(saved("HTTPS://X.TEST"), "HTTPS://X.TEST");
  assert.equal(saved("https://x.test/a"), "https://x.test/a");
});

test("checkLink: a schemeless localhost gets http://, any other host https://", () => {
  const saved = (url) => check("ok", url).url;
  assert.equal(saved("localhost"), "http://localhost");
  assert.equal(saved("localhost:3000/x"), "http://localhost:3000/x");
  assert.equal(saved("LOCALHOST:8080"), "http://LOCALHOST:8080");
  assert.equal(saved(" localhost/a?q=%s "), "http://localhost/a?q=%s");
  assert.equal(saved("localhost?x=1"), "http://localhost?x=1");
  assert.equal(saved("localhost.example.com"), "https://localhost.example.com");
  assert.equal(saved("localhostx:80"), "https://localhostx:80");
  assert.equal(saved("127.0.0.1:8000"), "https://127.0.0.1:8000");
  assert.equal(saved("foo.localhost"), "https://foo.localhost");
  assert.equal(saved("https://localhost"), "https://localhost");
  assert.equal(saved("http://localhost:3000"), "http://localhost:3000");
});

test("linksForUrl: a schemeless localhost is looked up as http://", () => {
  const links = { dev: "http://localhost:3000", sec: "https://localhost:3000" };
  assert.deepEqual(plain(sb().get(`linksForUrl(${JSON.stringify(links)}, "localhost:3000")`)), ["dev"]);
});

test("checkLink: a schemeless URL that is still invalid gets a plain error, not the scheme hint", () => {
  for (const url of ["foo bar", "//x.test", "mailto:a@b.c", "javascript:alert(1)", "exa mple.com/x"]) {
    const r = check("ok", url);
    assert.equal(r.ok, false, url);
  }
  assert.equal(check("ok", "foo bar").errors.url, "Enter a valid URL.");
  assert.match(check("ok", "ftp://x.test/f").errors.url, /http:\/\/ or https:\/\//);
});

test("checkLink: a schemeless URL is compared with its https:// form for an overwrite", () => {
  const links = { gh: "https://github.com" };
  assert.equal(check("gh", "github.com", links).overwrites, undefined);
  assert.equal(check("gh", "example.com", links).overwrites, "https://github.com");
});

test("checkLink: a bad URL and a bad name are both reported", () => {
  const r = check("a/b", "not a url");
  assert.ok(r.errors.name && r.errors.url);
});

test("checkLink: a name with a slash or whitespace is an error", () => {
  assert.ok(check("a/b", "https://x.test").errors.name);
  assert.ok(check("a b", "https://x.test").errors.name);
  assert.ok(check("a\tb", "https://x.test").errors.name);
  assert.ok(check("go/a/b", "https://x.test").errors.name);
  assert.ok(check("what?", "https://x.test").errors.name);
  assert.ok(check("a#b", "https://x.test").errors.name);
  assert.equal(check("c++", "https://x.test").ok, true);
});

test("checkLink: help is reserved", () => {
  assert.ok(check("help", "https://x.test").errors.name);
  assert.ok(check("go/help", "https://x.test").errors.name);
  assert.equal(check("helpful", "https://x.test").ok, true);
});

test("checkLink: a taken name reports what it points to now; a free name does not", () => {
  const links = { gh: "https://github.com", cs: "https://github.com/search?q=%s" };
  assert.deepEqual(check("gh", "https://example.com", links), {
    ok: true,
    name: "gh",
    url: "https://example.com",
    overwrites: "https://github.com",
  });
  assert.equal(check("new", "https://example.com", links).overwrites, undefined);
  // Not fooled by names that Object.prototype has.
  assert.equal(check("constructor", "https://example.com", links).overwrites, undefined);
  assert.equal(check("toString", "https://example.com", links).overwrites, undefined);
});

test("checkLink: saving the same destination again is not an overwrite", () => {
  const links = { gh: "https://github.com" };
  assert.equal(check("gh", "https://github.com", links).overwrites, undefined);
});

test("linksForUrl: every link with that destination, user or default, ignoring one trailing /", () => {
  const { get } = sb();
  const links = {
    github: "https://github.com",
    gh: "https://github.com/",
    mine: "https://github.com",
    other: "https://example.com",
    deep: "https://github.com//",
  };
  const names = (u) => plain(get(`linksForUrl(${JSON.stringify(links)}, ${JSON.stringify(u)})`));
  assert.deepEqual(names("https://github.com"), ["github", "gh", "mine"]);
  assert.deepEqual(names("https://github.com/"), ["github", "gh", "mine"]);
  assert.deepEqual(names("  https://github.com  "), ["github", "gh", "mine"]);
  assert.deepEqual(names("https://example.com"), ["other"]);
  assert.deepEqual(names("https://nothing.test"), []);
  assert.deepEqual(names(""), []);
  assert.deepEqual(names("github.com"), ["github", "gh", "mine"]);
  assert.deepEqual(names("example.com/"), ["other"]);
});

test("linksForUrl: a path keeps its meaning (only one trailing slash is ignored)", () => {
  const links = { a: "https://x.test/a", b: "https://x.test/a/", c: "https://x.test/ab" };
  assert.deepEqual(plain(sb().get(`linksForUrl(${JSON.stringify(links)}, "https://x.test/a")`)), ["a", "b"]);
});

test("readLinks: merges stored defaults and local links without writing storage", async () => {
  const { fake, get } = sb();
  await get("getLinks()"); // what the background does at startup: stores the defaults
  fake.store.sync.localLinks = { gh: "https://mine", extra: "https://e" };
  const sets = [];
  const set = fake.api.storage.sync.set;
  fake.api.storage.sync.set = (v) => (sets.push(v), set(v));
  const links = plain(await get("readLinks()"));
  assert.equal(links.gh, "https://mine");
  assert.equal(links.extra, "https://e");
  assert.equal(links.github, "https://github.com");
  assert.deepEqual(sets, []);
});

test("readLinks: before the defaults are stored it falls back to getLinks()", async () => {
  const { fake, get } = sb();
  const links = plain(await get("readLinks()"));
  assert.equal(links.github, "https://github.com");
  assert.ok(fake.store.sync.defaultLinks);
});

test("checkLink: the name is saved lowercase", () => {
  assert.equal(check("Docs", "https://x.test").name, "docs");
  assert.equal(check("go/DOCS", "https://x.test").name, "docs");
});

test("checkLink: a name taken in another case is an overwrite, naming the current destination", () => {
  const r = check("GH", "https://other.test", { gh: "https://github.com" });
  assert.deepEqual(r, { ok: true, name: "gh", url: "https://other.test", overwrites: "https://github.com" });
  assert.equal(check("gh", "https://github.com", { gh: "https://github.com" }).overwrites, undefined);
  assert.equal(check("GH", "https://github.com", { gh: "https://github.com" }).overwrites, undefined);
});

test("checkLink: HELP is reserved in any case", () => {
  assert.ok(check("HELP", "https://x.test").errors.name);
});

test("saveLink: saves lowercase and removes every other case variant of the name", async () => {
  const { fake, get } = sb();
  fake.store.sync.localLinks = { GH: "https://a", Gh: "https://b", keep: "https://k" };
  await get('saveLink("GH", "https://new")');
  assert.deepEqual(plain(fake.store.sync.localLinks), { keep: "https://k", gh: "https://new" });
});

test("removeLinkName: removes every case variant of a name and nothing else", () => {
  const out = plain(sb().get('removeLinkName({ GH: "1", gh: "2", Gha: "3" }, "gH")'));
  assert.deepEqual(out, { Gha: "3" });
});
