// Check 5: rule updates are serialised, and link names are matched literally.
// Storage is written by the harness page (see harness/test.js).
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

async function harness(op) {
  await navigate(`https://go/zztest-${op}`);
  const url = await fx.ff.waitFor(() => fx.ff.currentUrl(), (u) => u.includes("#result="), 12_000);
  assert.ok(url.includes("#result="), `harness gave no result, url=${url}`);
  const result = JSON.parse(Buffer.from(url.split("#result=")[1], "hex").toString());
  assert.ok(result.ok, `harness ${op} failed: ${result.error}`);
}

async function redirectsTo(url, expected) {
  await navigate(url);
  const final = await fx.ff.waitUrl((u) => u.startsWith("https://example.com/"));
  assert.equal(final, expected);
}

const errors = () => fx.ff.log().split("\n").filter((l) => l.includes("JavaScript error"));

describe("concurrent rule updates", () => {
  test("a burst of storage changes never fails and leaves the last state", async () => {
    await harness("burst");
    await redirectsTo("https://go/zzburst6", "https://example.com/6");
    assert.deepEqual(errors(), []);
  });
});

describe("link names are matched literally", () => {
  test("regex characters in a parameterised link name", async () => {
    await harness("regex");
    await redirectsTo("https://go/a.b/test", "https://example.com/dot?x=test");
    await redirectsTo("https://go/c++/test", "https://example.com/plus?x=test");
  });

  test("the dot in a.b does not match any character", async () => {
    await navigate("https://go/aXb/test");
    const final = await fx.ff.waitUrl((u) => u.startsWith("moz-extension://"));
    assert.ok(final.endsWith("/notfound.html"), `go/aXb/test -> ${final}`);
  });

  test("no errors were logged", () => assert.deepEqual(errors(), []));
});
