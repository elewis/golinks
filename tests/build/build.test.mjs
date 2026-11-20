import { test } from "node:test";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assemble, build, REPO } from "../../scripts/build.mjs";

const tmp = mkdtempSync(path.join(tmpdir(), "golinks-build-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

for (const browser of ["chrome", "firefox"]) {
  test(`${browser} build holds common files and its own, byte for byte`, () => {
    const dest = build(browser, path.join(tmp, browser));
    for (const f of ["api.js", "links.js", "rules.js", "index.js", "index.html", "notfound.html"]) {
      assert.deepEqual(readFileSync(path.join(dest, f)), readFileSync(path.join(REPO, "common", f)), f);
    }
    for (const f of ["manifest.json", "background.js"]) {
      assert.deepEqual(readFileSync(path.join(dest, f)), readFileSync(path.join(REPO, browser, f)), f);
    }
  });
}

test("a file name in two source folders is an error and builds nothing", () => {
  const a = path.join(tmp, "a"), b = path.join(tmp, "b");
  for (const d of [a, b]) mkdirSync(d);
  writeFileSync(path.join(a, "same.js"), "1");
  writeFileSync(path.join(b, "same.js"), "2");
  assert.throws(() => assemble(path.join(tmp, "out"), [a, b]), /both have: same\.js/);
  assert.equal(existsSync(path.join(tmp, "out")), false);
});

test("an unknown browser is an error", () => {
  assert.throws(() => build("opera", path.join(tmp, "x")), /unknown browser/);
});

test("every script the manifests and pages load exists in the build", () => {
  const ff = build("firefox", path.join(tmp, "ff2"));
  const manifest = JSON.parse(readFileSync(path.join(ff, "manifest.json"), "utf8"));
  for (const s of manifest.background.scripts) assert.ok(existsSync(path.join(ff, s)), s);
  const cr = build("chrome", path.join(tmp, "cr2"));
  const worker = readFileSync(path.join(cr, "background.js"), "utf8");
  for (const [, list] of worker.matchAll(/importScripts\(([^)]*)\)/g))
    for (const [, s] of list.matchAll(/"([^"]+)"/g)) assert.ok(existsSync(path.join(cr, s)), s);
  for (const dir of [ff, cr])
    for (const [, s] of readFileSync(path.join(dir, "index.html"), "utf8").matchAll(/src="([^"]+)"/g))
      assert.ok(existsSync(path.join(dir, s)), s);
});

test("pnpm load:firefox rebuilds dist/firefox before it looks for a profile", () => {
  const marker = path.join(REPO, "dist/firefox/stale-marker");
  build("firefox");
  writeFileSync(marker, "stale");
  // No such profile: the loader fails after the build, without starting Firefox.
  const r = spawnSync(process.execPath, [path.join(REPO, "scripts/load-firefox.mjs"), "--profile", path.join(tmp, "no-such-profile")], { encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.equal(existsSync(marker), false, "dist/firefox was not rebuilt");
  assert.ok(existsSync(path.join(REPO, "dist/firefox/rules.js")));
});
