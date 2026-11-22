// Appearance (Light | Dark | System): each explicit mode sets the page colours whatever the browser's
// setting is, System follows the emulated prefers-color-scheme, and the choice persists and is shared.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startChrome } from "./lib/fixture.mjs";

const LIGHT = "rgb(246, 247, 249)"; // --color-ground, light
const DARK = "rgb(16, 20, 26)"; // --color-ground, dark

let fx, ext;
before(async () => {
  fx = await startChrome();
  ext = await fx.chrome.newPage();
});
after(() => fx?.stop());

const ev = (expr) => fx.chrome.evaluate(ext, expr);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await sleep(50);
  }
  assert.fail(`timed out waiting for ${what}`);
}
const emulate = (scheme) =>
  fx.chrome.send(
    "Emulation.setEmulatedMedia",
    { features: [{ name: "prefers-color-scheme", value: scheme }] },
    ext.sessionId,
  );
const open = async (page = "index.html") => {
  await fx.chrome.navigate(ext, `${fx.chrome.origin}/${page}`);
  await fx.chrome.waitUrl(ext, (u) => u.endsWith(`/${page}`));
  await until(() => ev(`!!document.body`), "the body");
};
const background = () => ev(`getComputedStyle(document.body).backgroundColor`);
const pressed = () => ev(`document.querySelector(".segmented [aria-pressed=true]")?.dataset.mode`);
const choose = (mode) => ev(`document.querySelector('.segmented [data-mode="${mode}"]').click(); true`);

test("System (the default) follows the browser's light or dark setting, live", async () => {
  await emulate("light");
  await open();
  assert.equal(await ev(`document.documentElement.dataset.theme ?? null`), null);
  assert.equal(await pressed(), "system");
  assert.equal(await background(), LIGHT);
  await emulate("dark");
  await until(async () => (await background()) === DARK, "the page to turn dark with the setting");
  assert.equal(await ev(`getComputedStyle(document.documentElement).colorScheme`), "light dark");
});

test("Light and Dark win over the browser's setting, are stored, and persist across reloads", async () => {
  await emulate("dark");
  await open();
  await choose("light");
  await until(async () => (await background()) === LIGHT, "Light");
  assert.equal(await ev(`chrome.storage.local.get("appearance").then((o) => o.appearance)`), "light");
  assert.equal(await pressed(), "light");
  await open(); // reload: the choice is back, with no wrong flash (the cache applies it before the script's async read)
  assert.equal(await ev(`document.documentElement.dataset.theme`), "light");
  assert.equal(await background(), LIGHT);
  await emulate("light");
  await choose("dark");
  await until(async () => (await background()) === DARK, "Dark");
  assert.equal(await ev(`chrome.storage.local.get("appearance").then((o) => o.appearance)`), "dark");
  await open("popup.html"); // the other pages follow
  assert.equal(await background(), DARK);
  await open("notfound.html?name=zz");
  assert.equal(await background(), DARK);
  await open("styleguide.html");
  assert.equal(await background(), DARK);
});

test("a change on one page reaches another open page, an invalid stored value is System", async () => {
  await emulate("light");
  await open("popup.html");
  const other = await fx.chrome.newPage();
  await fx.chrome.navigate(other, `${fx.chrome.origin}/index.html`);
  await fx.chrome.waitUrl(other, (u) => u.endsWith("/index.html"));
  await sleep(500);
  await fx.chrome.evaluate(other, `document.querySelector('.segmented [data-mode="dark"]').click(); true`);
  await until(async () => (await background()) === DARK, "the popup to follow the other page");
  await ev(`chrome.storage.local.set({ appearance: "sepia" })`);
  await until(async () => (await background()) === LIGHT, "an invalid value to mean System");
  await ev(`chrome.storage.local.remove("appearance")`);
});
