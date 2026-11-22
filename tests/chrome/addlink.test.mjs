// The shared add-link form on the not-found page, the popup page and go/help:
// prefill, validation, overwrite confirmation, existing links for a URL.
// The real toolbar click, Alt+Shift+G and the active-tab prefill are not
// covered: DevTools cannot press them. The popup is opened as a normal tab,
// where "the active tab" is the popup itself.
import { storedLinksExpr } from "../lib/links.mjs";
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
const local = () => ev(storedLinksExpr);

describe("add-link form", () => {
  test("not-found page: name prefilled, URL empty and focused; saving makes the link redirect", async () => {
    await open("https://go/zznew", `${fx.chrome.origin}/notfound.html`);
    assert.equal(await ev(`location.search`), "?name=zznew");
    assert.equal(await ev(`document.getElementById("link-name").value`), "zznew");
    assert.equal(await ev(`document.getElementById("link-url").value`), "");
    assert.equal(await ev(`document.activeElement.id`), "link-url");
    await fill("zznew", "example.com/new");
    await click();
    await until(async () => (await local()).zznew === "https://example.com/new", "the link in storage");
    assert.equal(await text("link-status"), "Saved go/zznew");
    assert.equal(await ev(`document.getElementById("link-name").value`), "");
    assert.equal(await ev(`document.getElementById("link-url").value`), "");
    assert.equal(await ev(`document.activeElement.id`), "link-name");
    await until(
      () =>
        ev(
          `chrome.declarativeNetRequest.getDynamicRules().then((rs) => rs.some((r) => JSON.stringify(r.condition).includes("go/zznew")))`,
        ),
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
    assert.equal(await ev(`document.querySelector("#links tfoot #link-name") !== null`), true);
  });

  test("go/help: the name and URL boxes line up with the Link and Destination columns (content boxes)", async () => {
    await open("https://go/help", `${fx.chrome.origin}/index.html`);
    const aligned = () =>
      ev(`(() => {
        const [th1, th2] = document.querySelectorAll("#links th");
        const box = (th) => {
          const r = th.getBoundingClientRect();
          const s = getComputedStyle(th), l = parseFloat(s.paddingLeft);
          return { left: r.left + l, width: r.width - l - parseFloat(s.paddingRight) };
        };
        const near = (a, b) => Math.abs(a - b) < 1;
        const [n, u] = ["link-name", "link-url"].map((i) => document.getElementById(i).getBoundingClientRect());
        return near(n.left, box(th1).left) && near(n.width, box(th1).width) && near(u.left, box(th2).left) && near(u.width, box(th2).width);
      })()`);
    assert.equal(await aligned(), true);
    const long = `https://example.com/${"x".repeat(300)}`;
    await ev(`chrome.storage.sync.set({ "link:zzlong": ${JSON.stringify(long)} })`);
    await until(
      () => ev(`[...document.querySelectorAll("#links td")].some((td) => td.textContent === ${JSON.stringify(long)})`),
      "the long row",
    );
    assert.equal(await aligned(), true, "still lined up with a very long destination");
    await ev(`chrome.storage.sync.remove("link:zzlong")`);
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
    assert.deepEqual(
      await ev(`[document.getElementById("link-name").value, document.getElementById("link-url").value]`),
      ["okname", ""],
    );
    await fill("okname", "ftp://x.test/f");
    await click();
    await until(async () => (await text("link-url-error")) !== "", "the URL error");
    assert.equal(
      await ev(`document.getElementById("link-url").value`),
      "ftp://x.test/f",
      "an error keeps what was typed",
    );
  });

  test("a destination without a scheme is saved with https://, localhost with http://", async () => {
    await open(`${fx.chrome.origin}/popup.html`);
    await fill("zzlocal", "localhost:3000/x");
    await click();
    await until(async () => (await local()).zzlocal === "http://localhost:3000/x", "the localhost link in storage");
  });

  test("existing links for the URL are listed in the form, trailing / ignored, and do not block another name", async () => {
    await open(`${fx.chrome.origin}/notfound.html?name=zzgit`);
    await fill("", "https://github.com/");
    const list = () => ev(`[...document.querySelectorAll("#link-existing-list li")].map((l) => l.textContent).sort()`);
    await until(async () => (await list()).length > 0, "the list");
    assert.deepEqual(await list(), ["go/gh", "go/github"]);
    assert.equal(await ev(`document.getElementById("link-existing").hidden`), false);
    await fill("zzgit", "https://github.com");
    await click();
    await until(async () => (await local()).zzgit === "https://github.com", "the second name");
    await until(async () => (await text("link-status")) === "Saved go/zzgit", "the saved status");
    assert.deepEqual(await list(), [], "the cleared form lists nothing");
    assert.equal(await ev(`document.getElementById("link-existing").hidden`), true);
    await fill("", "https://github.com");
    await until(async () => (await list()).includes("go/zzgit"), "the new name in the list");
    await fill("", "https://nothing.test");
    assert.deepEqual(await list(), []);
    assert.equal(await ev(`document.getElementById("link-existing").hidden`), true);
  });

  test("a taken name needs an explicit confirm that shows what it points to now", async () => {
    await open(`${fx.chrome.origin}/popup.html`);
    await fill("gh", "https://example.com/mine");
    await click();
    await until(
      async () => (await ev(`document.getElementById("add-btn").textContent`)).startsWith("Overwrite"),
      "the confirm",
    );
    assert.equal(
      await ev(`document.getElementById("add-btn").textContent`),
      "Overwrite go/gh (now -> https://github.com)",
    );
    await sleep(300);
    assert.equal((await local()).gh, "https://github.com", "nothing was written before the confirm");
    // Changing the name drops the confirm.
    await fill("zzother", "https://example.com/mine");
    assert.equal(await ev(`document.getElementById("add-btn").textContent`), "Add");
    await fill("gh", "https://example.com/mine");
    await click();
    await until(
      async () => (await ev(`document.getElementById("add-btn").textContent`)).startsWith("Overwrite"),
      "the confirm again",
    );
    // The popup closes itself after a save; window.close is stubbed here (a tab is no popup).
    await ev(`window.__closed = 0; window.close = () => { window.__closed++; }; true`);
    await click();
    await until(async () => (await local()).gh === "https://example.com/mine", "the overwrite");
    await until(async () => (await text("link-status")) !== "", "the success line");
    assert.equal(await text("link-status"), "Saved go/gh -> https://example.com/mine");
    assert.equal(await ev(`document.getElementById("link-status").className`), "msg-success");
    assert.deepEqual(
      await ev(`["link-name", "link-url", "add-btn"].map((i) => document.getElementById(i).disabled)`),
      [true, true, true],
      "the form cannot be submitted again while the popup waits to close",
    );
    assert.equal(await ev(`window.__closed`), 0, "not closed at once");
    await until(async () => (await ev(`window.__closed`)) > 0, "the popup to close itself");
    assert.equal(await ev(`window.__closed`), 1);
    await fx.chrome.navigate(page, "https://go/gh");
    assert.equal(
      await fx.chrome.waitUrl(page, (u) => u.startsWith("https://example.com/")),
      "https://example.com/mine",
    );
  });
});
