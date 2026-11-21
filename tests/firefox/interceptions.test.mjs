// Check 5: every intercepted address-bar search is recorded in
// storage.local.interceptions (newest last, capped), and nothing else is.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startFirefox } from "./lib/fixture.mjs";

let fx;
before(async () => (fx = await startFirefox()));
after(() => fx?.stop());

async function navigate(url) {
  await fx.ff.get("about:blank");
  await fx.ff.waitUrl((u) => u === "about:blank");
  await fx.ff.get(url);
}

/** Run a harness operation and return its result. */
async function harness(op) {
  await navigate(`https://go/zztest-${op}`);
  const url = await fx.ff.waitFor(
    () => fx.ff.currentUrl(),
    (u) => u.includes("#result="),
    15_000,
  );
  assert.ok(url.includes("#result="), `harness gave no result, url=${url}`);
  const result = JSON.parse(Buffer.from(url.split("#result=")[1], "hex").toString());
  assert.ok(result.ok, `harness ${op} failed: ${result.error}`);
  return result;
}

describe("interceptions are recorded", () => {
  test("nothing is recorded before any interception", async () => {
    assert.deepEqual((await harness("log")).entries, []);
  });

  test("a non-intercepted URL adds no entry", async () => {
    await navigate("https://example.com/?q=gox");
    await fx.ff.waitUrl((u) => u !== "about:blank", 1500);
    assert.deepEqual((await harness("log")).entries, []);
  });

  test("an intercepted search adds one entry with from, to, at and tabId", async () => {
    const from = "https://www.google.co.uk/search?q=go%2Fgithub";
    await navigate(from);
    await fx.ff.waitUrl((u) => u.startsWith("https://github.com/"));
    const { entries } = await harness("log");
    assert.equal(entries.length, 1, JSON.stringify(entries));
    const [e] = entries;
    assert.equal(e.from, from);
    assert.equal(e.to, "https://go/github");
    assert.equal(typeof e.tabId, "number");
    assert.ok(Math.abs(Date.parse(e.at) - Date.now()) < 120_000 && e.at === new Date(e.at).toISOString(), e.at);
  });

  test("150 overlapping records keep only the last 100, in order", async () => {
    const { entries } = await harness("flood");
    assert.equal(entries.length, 100);
    assert.deepEqual(
      entries.map((e) => e.to),
      Array.from({ length: 100 }, (_, i) => `https://go/n${i + 50}`),
    );
  });
});
