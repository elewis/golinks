// The redirect log (storage.local `redirectLog:<UTC day>` keys): every go/ navigation is one
// entry { at, from, link, to, tabId }; pages that merely contain go/ add none.
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const entries = async () =>
  (await fx.chrome.evaluate(
    ext,
    `chrome.storage.local.get(null).then((all) => Object.keys(all).filter((k) => k.startsWith("redirectLog:")).sort().flatMap((k) => all[k]))`,
  )) ?? [];

async function until(fn, what) {
  for (let i = 0; i < 80; i++) {
    if (await fn()) return;
    await sleep(50);
  }
  assert.fail(`timed out waiting for ${what}`);
}

describe("the redirect log", () => {
  test("nothing is logged before any navigation", async () => {
    assert.deepEqual(await entries(), []);
  });

  test("https://go/github is one entry", async () => {
    await fx.chrome.navigate(page, "https://go/github");
    await fx.chrome.waitUrl(page, (u) => u.startsWith("https://github.com/"));
    await until(async () => (await entries()).length, "the entry");
    await sleep(300);
    const list = await entries();
    assert.equal(list.length, 1, JSON.stringify(list));
    const [e] = list;
    assert.deepEqual(Object.keys(e).sort(), ["at", "from", "link", "tabId", "to"]);
    assert.equal(e.from, "https://go/github");
    assert.equal(e.link, "github");
    assert.ok(e.to.startsWith("https://github.com/"), e.to);
    assert.equal(typeof e.tabId, "number");
    assert.ok(Math.abs(e.at - Date.now() / 1000) < 120, `at ${e.at}`);
  });

  test("a %s link logs the resolved destination under the lowercase name", async () => {
    await fx.chrome.navigate(page, "https://go/CS/FooBar");
    await fx.chrome.waitUrl(page, (u) => u.startsWith("https://github.com/search"));
    await until(async () => (await entries()).length === 2, "the entry");
    const [, e] = await entries();
    assert.equal(e.from, "https://go/CS/FooBar");
    assert.equal(e.link, "cs");
    assert.match(e.to, /^https:\/\/github\.com\/search\?.*FooBar/);
  });

  test("an unknown name is logged with the not-found page as `to`", async () => {
    await fx.chrome.navigate(page, "https://go/zznope");
    await fx.chrome.waitUrl(page, (u) => u.includes("notfound.html"));
    await until(async () => (await entries()).length === 3, "the entry");
    const [, , e] = await entries();
    assert.equal(e.link, "zznope");
    assert.match(e.to, /notfound\.html\?name=zznope$/);
  });

  test("http://go/gh is one entry (the scheme hop is joined)", async () => {
    await fx.chrome.navigate(page, "http://go/gh");
    await fx.chrome.waitUrl(page, (u) => u.startsWith("https://github.com/"));
    await until(async () => (await entries()).length >= 4, "the entry");
    await sleep(500);
    const list = await entries();
    assert.equal(list.length, 4, JSON.stringify(list));
    assert.equal(list[3].link, "gh");
  });

  test("a page that merely contains go/ adds no entry", async () => {
    await fx.chrome.navigate(page, "https://github.com/golang/go/issues");
    await fx.chrome.waitUrl(page, (u) => u.startsWith("https://github.com/golang"));
    await sleep(500);
    assert.equal((await entries()).length, 4);
  });

  test("go/help and bare go/ add no entry", async () => {
    await fx.chrome.navigate(page, "https://go/help");
    await fx.chrome.waitUrl(page, (u) => u.endsWith("/index.html"));
    await fx.chrome.navigate(page, "https://go/");
    await fx.chrome.waitUrl(page, (u) => u.endsWith("/index.html"));
    await sleep(500);
    assert.equal((await entries()).length, 4);
  });
});
