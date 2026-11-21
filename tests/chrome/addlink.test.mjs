// The shared add-link form on the not-found page, the popup page and go/help:
// prefill, validation, overwrite confirmation, existing links for a URL.
// The real toolbar click, Alt+Shift+G and the active-tab prefill are not
// covered: DevTools cannot press them. The popup is opened as a normal tab,
// where "the active tab" is the popup itself.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startChrome } from "./lib/fixture.mjs";

let fx, page;
before(async () => {
  fx = await startChrome();
  page = await fx.chrome.newPage();
});
after(() => fx?.stop());

const ev = (expr) => fx.chrome.evaluate(page, expr);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what) {
  for (let i = 0; i < 80; i++) {
    if (await fn()) return;
    await sleep(50);
  }
  assert.fail(`timed out waiting for ${what}`);
}

async function open(url, wantPrefix = url) {
  await fx.chrome.navigate(page, url);
  await fx.chrome.waitUrl(page, (u) => u.startsWith(wantPrefix));
  await until(() => ev(`!!document.getElementById("add-btn")`), "the form");
}
const fill = (name, url) =>
  ev(`(() => { const n = document.getElementById("link-name"), u = document.getElementById("link-url");
      n.value = ${JSON.stringify(name)}; u.value = ${JSON.stringify(url)};
      n.dispatchEvent(new Event("input")); u.dispatchEvent(new Event("input")); return true; })()`);
const click = () => ev(`document.getElementById("add-btn").click(); true`);
const text = (id) => ev(`document.getElementById(${JSON.stringify(id)}).textContent`);
const local = () => ev(`chrome.storage.sync.get("localLinks").then((r) => r.localLinks || {})`);

describe("add-link form", () => {
  test("not-found page: name prefilled, URL empty and focused; saving makes the link redirect", async () => {
    await open("https://go/zznew", `${fx.chrome.origin}/notfound.html`);
    assert.equal(await ev(`location.search`), "?name=zznew");
    assert.equal(await ev(`document.getElementById("link-name").value`), "zznew");
    assert.equal(await ev(`document.getElementById("link-url").value`), "");
    assert.equal(await ev(`document.activeElement.id`), "link-url");
    await fill("zznew", "https://example.com/new");
    await click();
    await until(async () => (await local()).zznew === "https://example.com/new", "the link in storage");
    assert.equal(await text("link-status"), "Saved go/zznew");
    await until(
      () => ev(`chrome.declarativeNetRequest.getDynamicRules().then((rs) => rs.some((r) => JSON.stringify(r.condition).includes("go/zznew")))`),
      "the rule",
    );
    await fx.chrome.navigate(page, "https://go/zznew");
    const url = await fx.chrome.waitUrl(page, (u) => u.startsWith("https://example.com/"));
    assert.equal(url, "https://example.com/new");
  });

  test("not-found page: go/csx/query still reaches not-found with the first segment as the name", async () => {
    await open("https://go/csx/query", `${fx.chrome.origin}/notfound.html`);
    assert.equal(await ev(`document.getElementById("link-name").value`), "csx");
  });

  test("not-found page: a + in the name stays a + (go/c++)", async () => {
    await open("https://go/c++", `${fx.chrome.origin}/notfound.html`);
    assert.equal(await ev(`document.getElementById("link-name").value`), "c++");
  });

  test("popup page: shows the same form, name empty; URL empty and focused when there is no tab URL to fill", async () => {
    await open(`${fx.chrome.origin}/popup.html`);
    assert.equal(await ev(`document.getElementById("link-name").value`), "");
    assert.equal(await ev(`document.activeElement.id`), "link-url");
  });

  test("go/help carries the same form", async () => {
    await open("https://go/help", `${fx.chrome.origin}/index.html`);
    assert.equal(await ev(`document.querySelectorAll("#add-link-form").length`), 1);
    assert.equal(await ev(`document.querySelector("#add-link #link-name") !== null`), true);
  });

  test("validation: empty, slash, space and reserved names are errors and write nothing", async () => {
    await open(`${fx.chrome.origin}/popup.html`);
    const before = await local();
    for (const [name, url, id] of [
      ["", "https://x.test", "link-name-error"],
      ["a/b", "https://x.test", "link-name-error"],
      ["a b", "https://x.test", "link-name-error"],
      ["help", "https://x.test", "link-name-error"],
      ["okname", "", "link-url-error"],
    ]) {
      await fill(name, url);
      await click();
      await until(async () => (await text(id)) !== "", `error for ${JSON.stringify([name, url])}`);
    }
    assert.deepEqual(await local(), before);
  });

  test("existing links for the URL are listed in the form, trailing / ignored, and do not block another name", async () => {
    await open(`${fx.chrome.origin}/popup.html`);
    await fill("", "https://github.com/");
    const list = () => ev(`[...document.querySelectorAll("#link-existing-list li")].map((l) => l.textContent).sort()`);
    await until(async () => (await list()).length > 0, "the list");
    assert.deepEqual(await list(), ["go/gh", "go/github"]);
    assert.equal(await ev(`document.getElementById("link-existing").hidden`), false);
    await fill("zzgit", "https://github.com");
    await click();
    await until(async () => (await local()).zzgit === "https://github.com", "the second name");
    await until(async () => (await list()).includes("go/zzgit"), "the new name in the list");
    await fill("", "https://nothing.test");
    assert.deepEqual(await list(), []);
    assert.equal(await ev(`document.getElementById("link-existing").hidden`), true);
  });

  test("a taken name needs an explicit confirm that shows what it points to now", async () => {
    await open(`${fx.chrome.origin}/popup.html`);
    await fill("gh", "https://example.com/mine");
    await click();
    await until(async () => (await ev(`document.getElementById("add-btn").textContent`)).startsWith("Overwrite"), "the confirm");
    assert.equal(await ev(`document.getElementById("add-btn").textContent`), "Overwrite go/gh (now -> https://github.com)");
    await sleep(300);
    assert.equal((await local()).gh, undefined, "nothing was written before the confirm");
    // Changing the name drops the confirm.
    await fill("zzother", "https://example.com/mine");
    assert.equal(await ev(`document.getElementById("add-btn").textContent`), "Add");
    await fill("gh", "https://example.com/mine");
    await click();
    await until(async () => (await ev(`document.getElementById("add-btn").textContent`)).startsWith("Overwrite"), "the confirm again");
    await click();
    await until(async () => (await local()).gh === "https://example.com/mine", "the overwrite");
    assert.equal(await text("link-status"), "Saved go/gh");
    assert.equal(await ev(`document.getElementById("add-btn").textContent`), "Add");
    await fx.chrome.navigate(page, "https://go/gh");
    assert.equal(await fx.chrome.waitUrl(page, (u) => u.startsWith("https://example.com/")), "https://example.com/mine");
  });
});
