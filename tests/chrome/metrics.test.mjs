// Usage metrics (storage.local.linkMetrics): a redirect to a saved link's
// destination is a hit; nothing else is. Read from an extension page.
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
const metrics = async () =>
  (await fx.chrome.evaluate(ext, `chrome.storage.local.get("linkMetrics").then((r) => r.linkMetrics || {})`)) ?? {};

async function until(fn, what) {
  for (let i = 0; i < 80; i++) {
    if (await fn()) return;
    await sleep(50);
  }
  assert.fail(`timed out waiting for ${what}`);
}

describe("link usage metrics", () => {
  test("nothing is recorded before any hit", async () => {
    // Seeding the default links is an edit (lastEdit), not a hit.
    for (const [name, stat] of Object.entries(await metrics())) {
      assert.equal(stat.count, 0, name);
      assert.equal(stat.lastHit, undefined, name);
    }
  });

  test("https://go/github counts one hit with lastHit set", async () => {
    await fx.chrome.navigate(page, "https://go/github");
    await fx.chrome.waitUrl(page, (u) => u.startsWith("https://github.com/"));
    await until(async () => (await metrics()).github, "the hit");
    await sleep(300);
    const { github } = await metrics();
    assert.equal(github.count, 1);
    assert.ok(Math.abs(github.lastHit - Date.now() / 1000) < 120, `lastHit ${github.lastHit}`);
    assert.equal(github.recent.length, 1);
  });

  test("a parameterised link and a case variant count under the lowercase name", async () => {
    await fx.chrome.navigate(page, "https://go/CS/FooBar");
    await fx.chrome.waitUrl(page, (u) => u.startsWith("https://github.com/search"));
    await until(async () => (await metrics()).cs, "the hit");
    assert.equal((await metrics()).cs.count, 1);
  });

  test("http://go/gh counts one hit", async () => {
    await fx.chrome.navigate(page, "http://go/gh");
    await fx.chrome.waitUrl(page, (u) => u.startsWith("https://github.com/"));
    await until(async () => (await metrics()).gh, "the hit");
    await sleep(300);
    assert.equal((await metrics()).gh.count, 1);
  });

  test("unknown names, go/help and go/ count nothing", async () => {
    const before = JSON.stringify(await metrics());
    for (const [url, want] of [
      ["https://go/zznope", "/notfound.html"],
      ["https://go/help", "/index.html"],
      ["https://go/", "/index.html"],
    ]) {
      await fx.chrome.navigate(page, url);
      await fx.chrome.waitUrl(page, (u) => u.startsWith(fx.chrome.origin) && u.includes(want));
    }
    await sleep(800);
    assert.equal(JSON.stringify(await metrics()), before);
  });

  test("adding a link sets lastEdit; the same destination and a deletion do not", async () => {
    const set = (v) => fx.chrome.evaluate(ext, `chrome.storage.sync.set({ "link:zzedit": ${JSON.stringify(v)} })`);
    await set("https://example.com/one");
    await until(async () => (await metrics()).zzedit?.lastEdit, "lastEdit");
    const first = (await metrics()).zzedit.lastEdit;
    assert.ok(Math.abs(first - Date.now() / 1000) < 120);
    await set("https://example.com/one");
    await fx.chrome.evaluate(ext, `chrome.storage.sync.remove("link:zzedit")`);
    await sleep(500);
    const stat = (await metrics()).zzedit;
    assert.equal(stat.lastEdit, first);
    assert.equal(stat.count, 0);
  });

  test("go/help shows hits, last hit and last edited", async () => {
    await fx.chrome.navigate(ext, `${fx.chrome.origin}/index.html`);
    await until(() => fx.chrome.evaluate(ext, `document.querySelectorAll("#links tr").length > 0`), "the help table");
    const rows = await fx.chrome.evaluate(
      ext,
      `Object.fromEntries([...document.querySelectorAll("#links tr")].map((r) => [r.firstChild.textContent, [...r.querySelectorAll("td")].map((c) => c.textContent)]))`,
    );
    const [name, , hits, lastHit, lastEdit] = rows["go/github"];
    assert.equal(name, "go/github");
    assert.equal(hits, "1");
    assert.match(lastHit, /^\d{2}\/\d{2}\/\d{4},? \d{2}:\d{2}:\d{2}$/);
    assert.match(lastEdit, /^\d{2}\/\d{2}\/\d{4},? \d{2}:\d{2}:\d{2}$/, "seeded, so it has a last edit");
    assert.equal(rows["go/gg"][2], "0");
    assert.equal(rows["go/gg"][3], "never");
  });

  test("go/help sorts by link A→Z at first, by the clicked column, and remembers the choice", async () => {
    const snap = `(() => {
      const rows = [...document.querySelectorAll("#links tbody tr")];
      return {
        names: rows.map((r) => r.firstChild.textContent),
        hits: rows.map((r) => Number(r.cells[2].textContent)),
        sorted: [...document.querySelectorAll("#links th[aria-sort]")].map((th) => th.textContent + ":" + th.getAttribute("aria-sort")),
      };
    })()`;
    const clickHits = `[...document.querySelectorAll("#links th button")].find((b) => b.textContent === "Hits").click()`;
    const open = async () => {
      await fx.chrome.navigate(ext, `${fx.chrome.origin}/index.html`);
      await until(() => fx.chrome.evaluate(ext, `document.querySelectorAll("#links tbody tr").length > 0`), "rows");
    };
    await fx.chrome.evaluate(ext, `chrome.storage.local.remove("helpSort")`);
    await open();
    const initial = await fx.chrome.evaluate(ext, snap);
    assert.deepEqual(
      initial.names,
      [...initial.names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    );
    assert.deepEqual(initial.sorted, ["Link:ascending"]);
    await fx.chrome.evaluate(ext, clickHits);
    const desc = await fx.chrome.evaluate(ext, snap);
    assert.deepEqual(desc.sorted, ["Hits:descending"]);
    assert.deepEqual(
      desc.hits,
      [...desc.hits].sort((a, b) => b - a),
    );
    await fx.chrome.evaluate(ext, clickHits);
    const asc = await fx.chrome.evaluate(ext, snap);
    assert.deepEqual(asc.sorted, ["Hits:ascending"]);
    assert.deepEqual(
      asc.hits,
      [...asc.hits].sort((a, b) => a - b),
    );
    await open();
    assert.deepEqual(await fx.chrome.evaluate(ext, snap), asc, "a new page load keeps the choice");
    await fx.chrome.evaluate(ext, `chrome.storage.local.remove("helpSort")`);
  });
});
