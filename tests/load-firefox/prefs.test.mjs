import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { REQUIRED_PREFS, applyPrefs, missingPrefs } from "../../scripts/lib/prefs.mjs";

const dir = () => mkdtempSync(path.join(os.tmpdir(), "golinks-prof-"));

test("an empty profile is missing every required pref", () => {
  assert.deepEqual(missingPrefs(dir()), REQUIRED_PREFS);
});

test("prefs already set in prefs.js or user.js are not missing", () => {
  const d = dir();
  writeFileSync(path.join(d, "prefs.js"), 'user_pref("devtools.debugger.remote-enabled", true);\n');
  assert.deepEqual(missingPrefs(d).map((p) => p.name), ["devtools.debugger.prompt-connection", "devtools.chrome.enabled"]);
  writeFileSync(path.join(d, "user.js"), 'user_pref("devtools.debugger.prompt-connection", false);\nuser_pref("devtools.chrome.enabled", true);\n');
  assert.deepEqual(missingPrefs(d), []);
});

test("user.js overrides prefs.js", () => {
  const d = dir();
  writeFileSync(path.join(d, "prefs.js"), 'user_pref("devtools.debugger.remote-enabled", true);\nuser_pref("devtools.debugger.prompt-connection", false);\nuser_pref("devtools.chrome.enabled", true);\n');
  writeFileSync(path.join(d, "user.js"), 'user_pref("devtools.debugger.remote-enabled", false);\n');
  assert.deepEqual(missingPrefs(d).map((p) => p.name), ["devtools.debugger.remote-enabled"]);
});

test("applyPrefs appends to user.js, keeps existing content, and returns the lines it wrote", () => {
  const d = dir();
  writeFileSync(path.join(d, "user.js"), 'user_pref("browser.startup.page", 3);\n');
  const lines = applyPrefs(d, missingPrefs(d));
  const text = readFileSync(path.join(d, "user.js"), "utf8");
  assert.ok(text.startsWith('user_pref("browser.startup.page", 3);\n'));
  assert.ok(text.includes('user_pref("devtools.debugger.remote-enabled", true);'));
  assert.ok(text.includes('user_pref("devtools.debugger.prompt-connection", false);'));
  assert.deepEqual(lines, [
    'user_pref("devtools.debugger.remote-enabled", true);',
    'user_pref("devtools.debugger.prompt-connection", false);',
    'user_pref("devtools.chrome.enabled", true);',
  ]);
  assert.deepEqual(missingPrefs(d), []);
});

test("applyPrefs is a no-op when nothing is missing", () => {
  const d = dir();
  assert.deepEqual(applyPrefs(d, []), []);
});
