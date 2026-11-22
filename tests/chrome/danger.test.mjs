// The danger zone of go/help: "Reset to default" and "Clear metrics", each behind
// the confirmation dialog. Driven in the extension page.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { setLinksExpr, storedLinksExpr } from "../lib/links.mjs";
import { startChrome } from "./lib/fixture.mjs";

let fx, ext;
before(async () => {
  fx = await startChrome();
  ext = await fx.chrome.newPage();
  await fx.chrome.navigate(ext, `${fx.chrome.origin}/index.html`);
  await fx.chrome.waitUrl(ext, (u) => u.endsWith("/index.html"));
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
const click = (id) => ev(`document.getElementById(${JSON.stringify(id)}).click(); true`);
const dialogOpen = () => ev(`document.getElementById("confirm-dialog").open`);
const closed = () => until(async () => !(await dialogOpen()), "the dialog to close");
const localKeys = async () => (await ev(`chrome.storage.local.get(null).then((o) => Object.keys(o))`)).sort();
const hasRule = (name) =>
  ev(
    `chrome.declarativeNetRequest.getDynamicRules().then((rs) => rs.some((r) => JSON.stringify(r.condition).includes("go/${name}")))`,
  );

test("clear metrics and reset: cancel and Escape change nothing, confirm does the work", async () => {
  const seedLocal = () =>
    ev(`chrome.storage.local.set({
      linkMetrics: { zzmine: { count: 5, lastHit: 1, lastEdit: 1, recent: [], hourly: [], daily: [] } },
      "redirectLog:2026-11-20": [{ at: 1, from: "a", link: "zzmine", to: "b", tabId: 1 }],
      helpSort: { column: "hits", dir: "desc" } })`);
  await ev(setLinksExpr({ zzmine: "https://example.com/mine" }));
  await sleep(500);
  await ev(`chrome.storage.local.remove(["linkMetrics", "helpSort"])`);
  await seedLocal();
  await fx.chrome.navigate(ext, `${fx.chrome.origin}/index.html`);
  await until(() => ev(`!!document.querySelector("#links tbody tr")`), "the help table");
  const shipped = await ev(`SHIPPED_LINKS`);
  const mine = { zzmine: "https://example.com/mine" };
  const deviceId = await ev(`chrome.storage.local.get("deviceId").then((o) => o.deviceId)`);
  assert.ok(deviceId);
  assert.deepEqual(await ev(`[...document.querySelectorAll(".danger-zone button")].map((b) => b.id)`), [
    "clear-btn",
    "reset-btn",
  ]);

  // Clear metrics.
  await click("clear-btn");
  assert.equal(await dialogOpen(), true);
  const clearText = await ev(`document.getElementById("confirm-text").textContent`);
  assert.match(clearText, /this device only/);
  assert.match(clearText, /cannot be undone/);
  await click("confirm-cancel");
  await closed();
  await sleep(300);
  const kept = await localKeys();
  assert.ok(kept.includes("linkMetrics") && kept.includes("redirectLog:2026-11-20"));
  await click("clear-btn");
  await click("confirm-ok");
  await closed();
  await until(async () => !(await localKeys()).includes("linkMetrics"), "the metrics to be cleared");
  const cleared = await localKeys();
  assert.ok(!cleared.some((k) => k.startsWith("redirectLog:")));
  assert.ok(cleared.includes("deviceId") && cleared.includes("helpSort"));
  assert.deepEqual(await ev(storedLinksExpr), mine);
  const hits = await ev(`[...document.querySelectorAll("#links tbody tr")].map((r) => r.cells[2].textContent)`);
  assert.ok(hits.length > 0 && hits.every((h) => h === "0"), "the hit column is empty after the clear");

  // Reset to default: a factory reset. Cancel, then Escape (dialog.close()), change nothing.
  await seedLocal();
  await click("reset-btn");
  assert.equal(await dialogOpen(), true);
  const text = await ev(`document.getElementById("confirm-text").textContent`);
  assert.match(text, /every\s+device/);
  assert.match(text, /cannot be undone/);
  assert.doesNotMatch(text, /metrics are kept/i);
  await click("confirm-cancel");
  await closed();
  await click("reset-btn");
  await ev(`document.getElementById("confirm-dialog").close(); true`);
  await closed();
  await sleep(300);
  assert.deepEqual(await ev(storedLinksExpr), mine);
  const keptReset = await localKeys();
  assert.ok(["helpSort", "linkMetrics", "redirectLog:2026-11-20"].every((k) => keptReset.includes(k)));

  await click("reset-btn");
  await click("confirm-ok");
  await closed();
  await until(async () => "gh" in (await ev(storedLinksExpr)), "the defaults");
  await until(async () => !(await localKeys()).includes("helpSort"), "helpSort to be removed");
  assert.deepEqual(await ev(storedLinksExpr), shipped);
  const seeded = await ev(
    `chrome.storage.sync.get(null).then((o) => Object.keys(o).filter((k) => k.startsWith("seeded:")).length)`,
  );
  assert.equal(seeded, Object.keys(shipped).length);
  await until(() => hasRule("github"), "the rule for a default");
  assert.equal(await hasRule("zzmine"), false);
  await sleep(300);
  const after = await localKeys();
  assert.ok(!after.some((k) => k.startsWith("redirectLog:")));
  assert.ok(!after.includes("helpSort"));
  assert.equal(await ev(`chrome.storage.local.get("linkMetrics").then((o) => o.linkMetrics?.zzmine)`), undefined);
  assert.equal(await ev(`chrome.storage.local.get("deviceId").then((o) => o.deviceId)`), deviceId);
});
