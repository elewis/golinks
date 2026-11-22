// Check 3: a link storage change updates the redirect rules.
// The options form is driven from the harness page (see harness/test.js).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startFirefox } from "./lib/fixture.mjs";

let fx;
before(async () => (fx = await startFirefox()));
after(() => fx?.stop());

/** Run one harness operation (add/del) and return its reported result. */
async function harness(op) {
  await fx.ff.get("about:blank");
  await fx.ff.waitUrl((u) => u === "about:blank");
  await fx.ff.get(`https://go/zztest-${op}`);
  const url = await fx.ff.waitFor(
    () => fx.ff.currentUrl(),
    (u) => u.includes("#result="),
    12_000,
  );
  assert.ok(url.includes("#result="), `harness gave no result, url=${url}`);
  const result = JSON.parse(Buffer.from(url.split("#result=")[1], "hex").toString());
  assert.ok(result.ok, `harness ${op} failed: ${result.error}`);
  return result;
}

async function finalUrl(url, predicate) {
  await fx.ff.get("about:blank");
  await fx.ff.waitUrl((u) => u === "about:blank");
  await fx.ff.get(url);
  return fx.ff.waitUrl(predicate);
}

const isNotFound = (u) => u.startsWith("moz-extension://") && u.includes("/notfound.html?name=");

describe("link storage changes update the rules", () => {
  test("link does not exist before it is added", async () => {
    const url = await finalUrl("https://go/zzmine", isNotFound);
    assert.ok(isNotFound(url), `go/zzmine -> ${url}`);
  });

  test("a link added through the options form redirects", async () => {
    await harness("add");
    const url = await finalUrl("https://go/zzmine", (u) => u.startsWith("https://example.com/"));
    assert.equal(url, "https://example.com/mine");
  });

  test("a link deleted through the options form stops redirecting", async () => {
    await harness("del");
    const url = await finalUrl("https://go/zzmine", isNotFound);
    assert.ok(isNotFound(url), `go/zzmine -> ${url}`);
  });
});

describe("default links are ordinary links", () => {
  test("go/help has Get Started and one Links table; deleting go/gg removes its redirect", async () => {
    const r = await harness("deldefault");
    assert.deepEqual(r.titles, ["Get Started", "Links"]);
    assert.equal(r.separate, false);
    const url = await finalUrl("https://go/gg", isNotFound);
    assert.ok(isNotFound(url), `go/gg -> ${url}`);
  });
});
