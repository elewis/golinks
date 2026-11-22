// The Settings section of go/help: "Clear metrics" and "Reset to default" (a factory
// reset), each behind the confirmation dialog. Driven from the harness page (op=danger).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startFirefox } from "./lib/fixture.mjs";

let fx;
before(async () => (fx = await startFirefox()));
after(() => fx?.stop());

test("clear metrics and reset: cancel and Escape change nothing, confirm does the work", async () => {
  await fx.ff.get("about:blank");
  await fx.ff.waitUrl((u) => u === "about:blank");
  await fx.ff.get("https://go/zztest-danger");
  const url = await fx.ff.waitFor(
    () => fx.ff.currentUrl(),
    (u) => u.includes("#result="),
    30_000,
  );
  assert.ok(url.includes("#result="), `harness gave no result, url=${url}`);
  const r = JSON.parse(Buffer.from(url.split("#result=")[1], "hex").toString());
  assert.ok(r.ok, `harness failed: ${r.error}`);
  const mine = { zzmine: "https://example.com/mine" };

  assert.deepEqual(r.buttonOrder, ["clear-btn", "reset-btn"], "Reset to default is the last button");
  assert.ok(r.deviceIdBefore);

  assert.equal(r.clearDialogOpen, true);
  assert.match(r.clearText, /this device only/);
  assert.match(r.clearText, /cannot be undone/);
  assert.ok(
    r.keysAfterClearCancel.includes("linkMetrics") && r.keysAfterClearCancel.includes("redirectLog:2026-11-20"),
  );
  assert.ok(!r.keysAfterClear.includes("linkMetrics"));
  assert.ok(!r.keysAfterClear.some((k) => k.startsWith("redirectLog:")));
  assert.ok(r.keysAfterClear.includes("deviceId") && r.keysAfterClear.includes("helpSort"));
  assert.deepEqual(r.linksAfterClear, mine, "clearing metrics leaves the links");
  assert.ok(r.hitsShown.length > 0 && r.hitsShown.every((h) => h === "0"), "the hit column is empty after the clear");

  assert.equal(r.resetDialogOpen, true);
  assert.match(r.resetText, /every device/);
  assert.match(r.resetText, /cannot be undone/);
  assert.doesNotMatch(r.resetText, /metrics are kept/i);
  assert.deepEqual(r.linksAfterResetCancel, mine, "cancel and Escape change nothing");
  assert.ok(["helpSort", "linkMetrics", "redirectLog:2026-11-20"].every((k) => r.keysAfterResetCancel.includes(k)));
  assert.deepEqual(r.linksAfterReset, r.shipped, "confirm: the links are exactly the shipped ones");
  assert.equal(r.seeded, Object.keys(r.shipped).length);
  assert.equal(r.ruleGithub, true);
  assert.equal(r.ruleMine, false);
  assert.ok(!r.keysAfterReset.includes("helpSort"), "the sort order is reset");
  assert.ok(!r.keysAfterReset.some((k) => k.startsWith("redirectLog:")));
  assert.equal(r.mineStat, undefined, "the old metrics are gone");
  assert.deepEqual(r.editedAfterReset, [], "the re-added defaults have no last edit");
  assert.equal(r.deviceIdAfter, r.deviceIdBefore, "the device id stays");
});
