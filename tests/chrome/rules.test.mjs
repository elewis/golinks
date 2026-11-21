// Check 5: rule updates are serialised, and link names are matched literally.
// Storage is written from an extension page opened as a normal tab.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startChrome } from "./lib/fixture.mjs";

let fx, page, ext;
before(async () => {
  fx = await startChrome();
  page = await fx.chrome.newPage();
  ext = await fx.chrome.newPage();
  await fx.chrome.navigate(ext, `${fx.chrome.origin}/index.html`);
  await fx.chrome.waitUrl(ext, (u) => u.endsWith("/index.html"));
});
after(() => fx?.stop());

const errors = () => fx.chrome.workerLogs.filter((l) => l.includes("JavaScript error") || l.startsWith("console.error"));

async function finalUrl(url, predicate) {
  await fx.chrome.navigate(page, url);
  return fx.chrome.waitUrl(page, predicate);
}
const isNotFound = (u) => u === `${fx.chrome.origin}/notfound.html`;
const setLinks = (links) =>
  fx.chrome.evaluate(ext, `chrome.storage.sync.set({ localLinks: ${JSON.stringify(links)} }).then(() => true)`);
const ruleCount = () => fx.chrome.evaluate(ext, `chrome.declarativeNetRequest.getDynamicRules().then((r) => r.length)`);
async function until(fn, what) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(`timed out waiting for ${what}`);
}

describe("concurrent rule updates", () => {
  test("a burst of storage changes never fails and leaves the last state", async () => {
    // Fire the writes without awaiting between them so the change events overlap.
    await fx.chrome.evaluate(
      ext,
      `Promise.all([1, 2, 3, 4, 5, 6].map((i) =>
         chrome.storage.sync.set({ localLinks: { ["zzburst" + i]: "https://example.com/" + i } }))).then(() => true)`,
    );
    const url = await finalUrl("https://go/zzburst6", (u) => u.startsWith("https://example.com/"));
    assert.equal(url, "https://example.com/6");
    // 8 default links + 1 local + help, root and not-found rules.
    await until(async () => (await ruleCount()) === 12, "final rule count");
    assert.deepEqual(errors(), []);
  });
});

describe("link names are matched literally", () => {
  test("regex characters in a parameterised link name", async () => {
    await setLinks({ "a.b": "https://example.com/dot?x=%s", "c++": "https://example.com/plus?x=%s" });
    await until(async () => (await ruleCount()) === 13, "rules for the new links");
    assert.equal(
      await finalUrl("https://go/a.b/test", (u) => u.startsWith("https://example.com/")),
      "https://example.com/dot?x=test",
    );
    assert.equal(
      await finalUrl("https://go/c++/test", (u) => u.startsWith("https://example.com/")),
      "https://example.com/plus?x=test",
    );
  });

  test("the dot in a.b does not match any character", async () => {
    const url = await finalUrl("https://go/aXb/test", isNotFound);
    assert.ok(isNotFound(url), `go/aXb/test -> ${url}`);
  });

  test("go/csx does not match the cs rule", async () => {
    const url = await finalUrl("https://go/csx/test", isNotFound);
    assert.ok(isNotFound(url), `go/csx/test -> ${url}`);
  });

  test("no errors were logged", () => assert.deepEqual(errors(), []));
});
