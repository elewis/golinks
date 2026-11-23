// The two data settings on go/help (storage.local, per device): "Usage metrics" (default on) and
// "Redirect log" (default off). Driven in the extension page; navigations go through the real redirect rules.
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
const ev = (expr) => fx.chrome.evaluate(ext, expr);
const local = () => ev(`chrome.storage.local.get(null)`);
const logKeys = async () => Object.keys(await local()).filter((k) => k.startsWith("redirectLog:"));
const count = async (name) => (await local()).linkMetrics?.[name]?.count ?? 0;

async function until(fn, what) {
  for (let i = 0; i < 80; i++) {
    if (await fn()) return;
    await sleep(50);
  }
  assert.fail(`timed out waiting for ${what}`);
}

async function go(url, destination = "https://github.com/") {
  await fx.chrome.navigate(page, url);
  await fx.chrome.waitUrl(page, (u) => u.startsWith(destination));
  await sleep(600);
}

const visible = (sel) =>
  ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => getComputedStyle(e).display !== "none")`);

describe("the data settings", () => {
  test("defaults: metrics on, log off, each checkbox has a label; a navigation is counted but not logged", async () => {
    assert.equal(await ev(`document.getElementById("metrics-enabled").checked`), true);
    assert.equal(await ev(`document.getElementById("log-enabled").checked`), false);
    assert.equal(await ev(`document.getElementById("metrics-enabled").labels[0].textContent`), "Usage metrics");
    assert.equal(await ev(`document.getElementById("log-enabled").labels[0].textContent`), "Redirect log");
    await go("https://go/github");
    assert.equal(await count("github"), 1);
    assert.deepEqual(await logKeys(), []);
  });

  test("log on: a navigation is logged; off: the log is deleted and nothing more is logged", async () => {
    await ev(`document.getElementById("log-enabled").click()`);
    await until(async () => (await local()).redirectLogEnabled === true, "the log setting");
    await go("https://go/github");
    await until(async () => (await logKeys()).length, "the entry");
    await ev(`document.getElementById("log-enabled").click()`);
    await until(async () => (await local()).redirectLogEnabled === false, "the log setting");
    await until(async () => (await logKeys()).length === 0, "the log to be deleted");
    await go("https://go/github");
    assert.deepEqual(await logKeys(), []);
  });

  test("metrics off: usage columns hidden, add button kept, no hit counted, stats kept; on again resumes", async () => {
    const before = await count("github");
    await ev(`chrome.storage.local.set({ helpSort: { column: "hits", dir: "desc" } })`);
    await fx.chrome.navigate(ext, `${fx.chrome.origin}/index.html`); // the page reads the sort when it loads
    await fx.chrome.waitUrl(ext, (u) => u.endsWith("/index.html"));
    await until(async () => (await visible("#links tbody tr")).length, "the links");
    await ev(`document.getElementById("metrics-enabled").click()`);
    await until(async () => (await local()).metricsEnabled === false, "the metrics setting");
    await until(async () => !(await visible("#links thead th"))[2], "the columns to hide");
    assert.deepEqual(await visible("#links thead th"), [true, true, false, false, false, true]);
    assert.deepEqual(await visible("#links tbody tr:first-child td"), [true, true, false, false, false, true]);
    assert.equal(await ev(`document.getElementById("add-btn").getBoundingClientRect().width > 0`), true);
    assert.deepEqual(await ev(`[...document.querySelectorAll("#links th[aria-sort]")].map((th) => th.textContent)`), [
      "Link",
    ]);
    assert.deepEqual((await local()).helpSort, { column: "hits", dir: "desc" }, "the stored sort stays");
    await go("https://go/github");
    assert.equal(await count("github"), before, "nothing counted while off");
    await ev(`document.getElementById("metrics-enabled").click()`);
    await until(async () => (await visible("#links thead th"))[2], "the columns to show");
    assert.deepEqual(await ev(`[...document.querySelectorAll("#links th[aria-sort]")].map((th) => th.textContent)`), [
      "Hits",
    ]);
    await go("https://go/github");
    assert.equal(await count("github"), before + 1);
    await ev(`chrome.storage.local.remove("helpSort")`);
  });
});
