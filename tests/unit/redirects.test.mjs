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

test("observeRedirects: one observe-only listener fans out to every consumer; a throwing one does not stop the rest", () => {
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
  assert.deepEqual(seen, ["gh"]);
  assert.ok(logs.some((l) => l[0] === "error"));
});
