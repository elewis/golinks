// Check 6: usage metrics (storage.local.linkMetrics): a redirect to a saved
// link's destination is a hit; nothing else is.
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

const metrics = async () => (await harness("metrics")).metrics;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("link usage metrics", () => {
  test("nothing is recorded before any hit", async () => {
    // Seeding the default links is an edit (lastEdit), not a hit.
    for (const [name, stat] of Object.entries(await metrics())) {
      assert.equal(stat.count, 0, name);
      assert.equal(stat.lastHit, undefined, name);
    }
  });

  test("https://go/github counts one hit with lastHit set", async () => {
    await navigate("https://go/github");
    await fx.ff.waitUrl((u) => u.startsWith("https://github.com/"));
    await sleep(500);
    const { github } = await metrics();
    assert.equal(github.count, 1);
    assert.ok(Math.abs(github.lastHit - Date.now() / 1000) < 120, `lastHit ${github.lastHit}`);
    assert.equal(github.recent.length, 1);
  });

  test("a parameterised link and a case variant count under the lowercase name", async () => {
    await navigate("https://go/CS/FooBar");
    await fx.ff.waitUrl((u) => u.startsWith("https://github.com/search"));
    await sleep(500);
    assert.equal((await metrics()).cs.count, 1);
  });

  test("unknown names, go/help and go/ count nothing", async () => {
    const before = JSON.stringify(await metrics());
    await navigate("https://go/zznope");
    await fx.ff.waitUrl((u) => u.includes("notfound.html"));
    await navigate("https://go/help");
    await fx.ff.waitUrl((u) => u.endsWith("/index.html"));
    await navigate("https://go/");
    await fx.ff.waitUrl((u) => u.endsWith("/index.html"));
    await sleep(500);
    assert.equal(JSON.stringify(await metrics()), before);
  });

  test("a search URL with q=go/<saved> counts exactly one hit", async () => {
    const before = (await metrics()).gh?.count ?? 0;
    await navigate("https://www.google.co.uk/search?q=go%2Fgh");
    await fx.ff.waitUrl((u) => u.startsWith("https://github.com/"));
    await sleep(800);
    assert.equal((await metrics()).gh.count, before + 1);
  });

  test("adding a link sets lastEdit; the same destination and a deletion do not", async () => {
    const { first, stat } = await harness("metricsedit");
    assert.ok(Math.abs(first - Date.now() / 1000) < 120);
    assert.equal(stat.lastEdit, first);
    assert.equal(stat.count, 0);
  });

  test("go/help shows hits, last hit and last edited", async () => {
    const { rows } = await harness("metricshelp");
    const [name, , hits, lastHit, lastEdit] = rows["go/github"];
    assert.equal(name, "go/github");
    assert.equal(hits, "1");
    assert.match(lastHit, /^\d{2}\/\d{2}\/\d{4},? \d{2}:\d{2}:\d{2}$/);
    assert.match(lastEdit, /^\d{2}\/\d{2}\/\d{4},? \d{2}:\d{2}:\d{2}$/, "seeded, so it has a last edit");
    assert.equal(rows["go/gg"][2], "0");
    assert.equal(rows["go/gg"][3], "never");
  });
});
