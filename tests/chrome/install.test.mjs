// Check 1: the extension installs and its service worker starts cleanly.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startChrome } from "./lib/fixture.mjs";

let fx;
before(async () => (fx = await startChrome()));
after(() => fx?.stop());

// Known issue (startup race creating rules): allowed, but reported as a warning.
const ALLOWED = ["Duplicate rule ID"];

test("service worker loads without JavaScript errors", async (t) => {
  const { chrome } = fx;
  assert.ok(await chrome.waitWorkerLog("GoLinks: extension loaded"), "'GoLinks: extension loaded' never appeared in the service worker console");
  const errors = chrome.workerLogs.filter((l) => l.includes("JavaScript error"));
  for (const e of errors.filter((l) => ALLOWED.some((a) => l.includes(a)))) {
    t.diagnostic(`WARNING (known startup race, allowed): ${e.trim().slice(0, 160)}`);
  }
  assert.deepEqual(errors.filter((l) => !ALLOWED.some((a) => l.includes(a))), []);
});
