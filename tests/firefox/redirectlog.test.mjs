// Check 5: every go/ navigation is one entry in storage.local `redirectLog:<UTC day>` keys
// ({ at, from, link, to, tabId }, newest last); a search and its go/ redirect
// are one entry; pages that merely contain go/ add none.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startFirefox } from "./lib/fixture.mjs";

let fx;
before(async () => {
  fx = await startFirefox();
  await harness("logon"); // the log is off by default
});
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const entries = async () => (await harness("log")).entries;

describe("the redirect log", () => {
  test("it is off by default: with no setting a navigation is not logged", async () => {
    await fx.ff.get("about:blank");
    await harness("logoff");
    await navigate("https://go/github");
    await fx.ff.waitUrl((u) => u.startsWith("https://github.com/"));
    await sleep(800);
    assert.deepEqual((await harness("log")).keys, []);
    await harness("logon");
  });

  test("nothing is logged before any navigation", async () => {
    assert.deepEqual(await entries(), []);
  });

  test("https://go/github is one entry", async () => {
    await navigate("https://go/github");
    await fx.ff.waitUrl((u) => u.startsWith("https://github.com/"));
    await sleep(500);
    const list = await entries();
    assert.equal(list.length, 1, JSON.stringify(list));
    const [e] = list;
    assert.deepEqual((await harness("log")).keys, [`redirectLog:${new Date().toISOString().slice(0, 10)}`]);
    assert.deepEqual(Object.keys(e).sort(), ["at", "from", "link", "tabId", "to"]);
    assert.equal(e.from, "https://go/github");
    assert.equal(e.link, "github");
    assert.ok(e.to.startsWith("https://github.com/"), e.to);
    assert.equal(typeof e.tabId, "number");
    assert.ok(Math.abs(e.at - Date.now() / 1000) < 120, `at ${e.at}`);
  });

  test("a %s link logs the resolved destination under the lowercase name", async () => {
    await navigate("https://go/CS/FooBar");
    await fx.ff.waitUrl((u) => u.startsWith("https://github.com/search"));
    await sleep(500);
    const list = await entries();
    assert.equal(list.length, 2);
    assert.equal(list[1].from, "https://go/CS/FooBar");
    assert.equal(list[1].link, "cs");
    assert.match(list[1].to, /^https:\/\/github\.com\/search\?.*FooBar/);
  });

  test("an unknown name is logged with the not-found page as `to`", async () => {
    await navigate("https://go/zznope");
    await fx.ff.waitUrl((u) => u.includes("notfound.html"));
    await sleep(500);
    const list = await entries();
    assert.equal(list.length, 3);
    assert.equal(list[2].link, "zznope");
    assert.match(list[2].to, /notfound\.html\?name=zznope$/);
  });

  test("an address-bar search and its go/ redirect are one entry, from = the search", async () => {
    const from = "https://www.google.co.uk/search?q=go%2Fgh";
    await navigate(from);
    await fx.ff.waitUrl((u) => u.startsWith("https://github.com/"));
    await sleep(800);
    const list = await entries();
    assert.equal(list.length, 4, JSON.stringify(list));
    assert.equal(list[3].from, from);
    assert.equal(list[3].link, "gh");
    assert.ok(list[3].to.startsWith("https://github.com/"), list[3].to);
  });

  test("http://go/gh is one entry", async () => {
    await navigate("http://go/gh");
    await fx.ff.waitUrl((u) => u.startsWith("https://github.com/"));
    await sleep(800);
    const list = await entries();
    assert.equal(list.length, 5, JSON.stringify(list));
    assert.equal(list[4].link, "gh");
    assert.ok(list[4].to.startsWith("https://github.com/"), list[4].to);
  });

  test("a page that merely contains go/ adds no entry", async () => {
    await navigate("https://example.com/?q=gox");
    await fx.ff.waitUrl((u) => u !== "about:blank", 1500);
    await sleep(500);
    assert.equal((await entries()).length, 5);
  });

  test("go/help and bare go/ add no entry", async () => {
    await navigate("https://go/help");
    await fx.ff.waitUrl((u) => u.endsWith("/index.html"));
    await navigate("https://go/");
    await fx.ff.waitUrl((u) => u.endsWith("/index.html"));
    await sleep(500);
    assert.equal((await entries()).length, 5);
  });

  test("turning the log off deletes it and later navigations add nothing", async () => {
    await harness("logoff");
    assert.deepEqual((await harness("log")).keys, []);
    await navigate("https://go/github");
    await fx.ff.waitUrl((u) => u.startsWith("https://github.com/"));
    await sleep(800);
    assert.deepEqual((await harness("log")).keys, []);
    await harness("logon");
  });

  test("20 overlapping appends keep every one and the 10,000 cap trims the oldest", async () => {
    const r = await harness("logflood");
    assert.equal(r.count, 10_000);
    assert.equal(r.firstTab, 10);
    assert.deepEqual(
      [...r.news].sort((a, b) => a - b),
      Array.from({ length: 20 }, (_, i) => i),
    );
  });
});
