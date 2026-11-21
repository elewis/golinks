// Check 1: the extension installs and its service worker starts cleanly.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startChrome } from "./lib/fixture.mjs";

let fx;
before(async () => (fx = await startChrome()));
after(() => fx?.stop());

test("service worker loads without JavaScript errors", async () => {
  const { chrome } = fx;
  assert.ok(
    await chrome.waitWorkerLog("GoLinks: extension loaded"),
    "'GoLinks: extension loaded' never appeared in the service worker console",
  );
  const errors = chrome.workerLogs.filter((l) => l.includes("JavaScript error"));
  assert.deepEqual(errors, []);
});
