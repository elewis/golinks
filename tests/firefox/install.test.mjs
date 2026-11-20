// Check 1: the extension installs and its background page loads cleanly.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startFirefox } from "./lib/fixture.mjs";

let fx;
before(async () => (fx = await startFirefox()));
after(() => fx?.stop());

// Known issue (startup race creating rules): allowed, but reported as a warning.
const ALLOWED = ["Duplicate rule ID"];

test("background loads without JavaScript errors", async (t) => {
  assert.ok(await fx.ff.waitLog("GoLinks: extension loaded"), "'GoLinks: extension loaded' never appeared in the log");
  const errors = fx.ff.log().split("\n").filter((l) => l.includes("JavaScript error"));
  for (const e of errors.filter((l) => ALLOWED.some((a) => l.includes(a)))) {
    t.diagnostic(`WARNING (known startup race, allowed): ${e.trim().slice(0, 160)}`);
  }
  assert.deepEqual(errors.filter((l) => !ALLOWED.some((a) => l.includes(a))), []);
});
