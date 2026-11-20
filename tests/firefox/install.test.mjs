// Check 1: the extension installs and its background page loads cleanly.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startFirefox } from "./lib/fixture.mjs";

let fx;
before(async () => (fx = await startFirefox()));
after(() => fx?.stop());

test("background loads without JavaScript errors", async () => {
  assert.ok(await fx.ff.waitLog("GoLinks: extension loaded"), "'GoLinks: extension loaded' never appeared in the log");
  const errors = fx.ff.log().split("\n").filter((l) => l.includes("JavaScript error"));
  assert.deepEqual(errors, []);
});
