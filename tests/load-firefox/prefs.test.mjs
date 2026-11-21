import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { REQUIRED_PREFS, applyPrefs, conflictingPrefs, existingPrefs, missingPrefs, movePrefsScript, removePrefs } from "../../scripts/lib/prefs.mts";

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

test("removePrefs takes out exactly the lines applyPrefs added and keeps the rest", () => {
  const d = dir();
  writeFileSync(path.join(d, "user.js"), 'user_pref("browser.startup.page", 3);\n');
  const lines = applyPrefs(d, missingPrefs(d));
  removePrefs(d, lines, false);
  assert.equal(readFileSync(path.join(d, "user.js"), "utf8"), 'user_pref("browser.startup.page", 3);\n');
});

test("removePrefs deletes a user.js that the loader created and left empty, but not one that existed", () => {
  const d = dir();
  const lines = applyPrefs(d, missingPrefs(d));
  removePrefs(d, lines, true);
  assert.equal(existsSync(path.join(d, "user.js")), false);
  const e = dir();
  writeFileSync(path.join(e, "user.js"), "");
  removePrefs(e, applyPrefs(e, missingPrefs(e)), false);
  assert.equal(readFileSync(path.join(e, "user.js"), "utf8"), "");
});

test("removePrefs leaves a line the user has added since, and tolerates a missing file", () => {
  const d = dir();
  const lines = applyPrefs(d, missingPrefs(d));
  appendFileSync(path.join(d, "user.js"), 'user_pref("x.y", 1);\n');
  removePrefs(d, lines, true);
  assert.equal(readFileSync(path.join(d, "user.js"), "utf8"), 'user_pref("x.y", 1);\n');
  removePrefs(dir(), lines, true);
});

test("conflictingPrefs finds a required pref the profile sets to the other value", () => {
  const d = dir();
  writeFileSync(path.join(d, "prefs.js"), 'user_pref("devtools.debugger.remote-enabled", false);\nuser_pref("devtools.chrome.enabled", true);\n');
  assert.deepEqual(conflictingPrefs(d).map((p) => p.name), ["devtools.debugger.remote-enabled"]);
  assert.deepEqual(conflictingPrefs(dir()), []);
});

test("existingPrefs lists the required prefs the profile already has set the wanted way", () => {
  const d = dir();
  writeFileSync(path.join(d, "prefs.js"), 'user_pref("devtools.debugger.remote-enabled", true);\nuser_pref("devtools.chrome.enabled", false);\n');
  assert.deepEqual(existingPrefs(d).map((p) => p.name), ["devtools.debugger.remote-enabled"]);
});

test("movePrefsScript moves each value from the user branch to the default branch", () => {
  const script = movePrefsScript(REQUIRED_PREFS);
  assert.match(script, /clearUserPref/);
  assert.match(script, /getDefaultBranch\(""\)\.setBoolPref/);
  for (const p of REQUIRED_PREFS) assert.ok(script.includes(JSON.stringify(p.name)));
});

test("movePrefsScript saves prefs.js itself and waits for it, so a quit right after cannot leave the old values", () => {
  const script = movePrefsScript(REQUIRED_PREFS);
  assert.match(script, /await Services\.prefs\.savePrefFile\(null\)/);
  assert.ok(script.indexOf("savePrefFile") > script.indexOf("setBoolPref"), "save only after every pref has moved");
});
