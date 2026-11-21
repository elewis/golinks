import { test } from "node:test";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assemble, build, emittedName, REPO, stripTypes } from "../../scripts/build.mts";

const tmp = mkdtempSync(path.join(tmpdir(), "golinks-build-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

for (const browser of ["chrome", "firefox"]) {
  test(`${browser} build holds common files and its own, byte for byte`, () => {
    const dest = build(browser, path.join(tmp, browser));
    // Sources that are not .ts are copied unchanged; .ts sources are emitted as stripped .js.
    for (const dir of [path.join(REPO, "common"), path.join(REPO, browser)]) {
      for (const f of readdirSync(dir)) {
        const out = readFileSync(path.join(dest, emittedName(f)));
        const src = readFileSync(path.join(dir, f));
        assert.deepEqual(out, f.endsWith(".ts") ? Buffer.from(stripTypes(src.toString("utf8"))) : src, f);
      }
    }
    for (const f of [
      "manifest.json",
      "background.js",
      "api.js",
      "links.js",
      "rules.js",
      "index.js",
      "index.html",
      "notfound.html",
      "notfound.js",
      "popup.html",
      "popup.js",
      "linkform.js",
    ]) {
      assert.ok(existsSync(path.join(dest, f)), `${f} missing from the build`);
    }
    assert.deepEqual(
      readdirSync(dest).filter((f) => f.endsWith(".ts")),
      [],
      "a .ts file reached the build",
    );
  });
}

test("a .ts file is emitted as .js with its types removed and its code kept", () => {
  const src = path.join(tmp, "ts-src"),
    out = path.join(tmp, "ts-out");
  mkdirSync(src);
  writeFileSync(
    path.join(src, "x.ts"),
    "const n: number = 1;\ninterface A { b: string }\nfunction f(a: A): string { return a.b + n; }\n",
  );
  writeFileSync(path.join(src, "y.json"), '{"a": 1}');
  assemble(out, [src]);
  const js = readFileSync(path.join(out, "x.js"), "utf8");
  assert.equal(existsSync(path.join(out, "x.ts")), false);
  assert.doesNotMatch(js, /number|interface|: A|: string/);
  assert.match(js, /function f\(a\s*\)\s*\{ return a\.b \+ n; \}/);
  assert.equal(readFileSync(path.join(out, "y.json"), "utf8"), '{"a": 1}');
});

test("syntax that is not erasable (enum) is an error", () => {
  const src = path.join(tmp, "enum-src");
  mkdirSync(src);
  writeFileSync(path.join(src, "e.ts"), "enum E { A }\n");
  assert.throws(() => assemble(path.join(tmp, "enum-out"), [src]), /e\.ts/);
});

test("x.ts in one folder and x.js in another is a name clash", () => {
  const a = path.join(tmp, "c-a"),
    b = path.join(tmp, "c-b");
  for (const d of [a, b]) mkdirSync(d);
  writeFileSync(path.join(a, "x.ts"), "1;");
  writeFileSync(path.join(b, "x.js"), "2;");
  assert.throws(() => assemble(path.join(tmp, "c-out"), [a, b]), /both have: x\.js/);
  assert.equal(existsSync(path.join(tmp, "c-out")), false);
});

test("a file name in two source folders is an error and builds nothing", () => {
  const a = path.join(tmp, "a"),
    b = path.join(tmp, "b");
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

test("both manifests give the toolbar a popup, bind Alt+Shift+G to it, and add only activeTab", () => {
  for (const browser of ["chrome", "firefox"]) {
    const dir = build(browser, path.join(tmp, `m-${browser}`));
    const m = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
    assert.equal(m.action.default_popup, "popup.html", browser);
    assert.ok(existsSync(path.join(dir, m.action.default_popup)), browser);
    assert.equal(m.commands._execute_action.suggested_key.default, "Alt+Shift+G", browser);
    assert.ok(m.permissions.includes("activeTab"), browser);
    assert.deepEqual(
      m.permissions.filter(
        (p) =>
          !["activeTab", "declarativeNetRequestWithHostAccess", "storage", "webRequest", "webRequestBlocking"].includes(
            p,
          ),
      ),
      [],
      browser,
    );
    for (const page of ["popup.html", "notfound.html", "index.html"]) {
      const html = readFileSync(path.join(dir, page), "utf8");
      assert.match(html, /src="linkform\.js"/, `${browser} ${page} loads the shared form`);
      assert.match(html, /id="add-link"/, `${browser} ${page}`);
    }
  }
});

test("pnpm load:firefox rebuilds dist/firefox before it looks for a profile", () => {
  const marker = path.join(REPO, "dist/firefox/stale-marker");
  build("firefox");
  writeFileSync(marker, "stale");
  // No such profile: the loader fails after the build, without starting Firefox.
  const r = spawnSync(
    process.execPath,
    [path.join(REPO, "scripts/load-firefox.mts"), "--profile", path.join(tmp, "no-such-profile")],
    { encoding: "utf8" },
  );
  assert.notEqual(r.status, 0);
  assert.equal(existsSync(marker), false, "dist/firefox was not rebuilt");
  assert.ok(existsSync(path.join(REPO, "dist/firefox/rules.js")));
});
