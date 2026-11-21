import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { findProfile, parseProfilesIni, runningPid } from "../../scripts/lib/profiles.mts";

const SNAP = ".mozilla/firefox";
function home(ini, { snap = true } = {}) {
  const h = mkdtempSync(path.join(os.tmpdir(), "golinks-home-"));
  const root = snap ? path.join(h, "snap/firefox/common", SNAP) : path.join(h, SNAP);
  mkdirSync(root, { recursive: true });
  if (ini !== undefined) writeFileSync(path.join(root, "profiles.ini"), ini);
  return { h, root };
}

test("parseProfilesIni reads sections as key/value maps", () => {
  const s = parseProfilesIni(
    "[General]\nVersion=2\n\n[Profile0]\nName=default\nIsRelative=1\nPath=abc.default\nDefault=1\n",
  );
  assert.equal(s.Profile0.Path, "abc.default");
  assert.equal(s.General.Version, "2");
});

test("the profile marked Default=1 is the default", () => {
  const { h, root } = home(
    "[Profile0]\nName=other\nIsRelative=1\nPath=o.other\n\n[Profile1]\nName=default\nIsRelative=1\nPath=d.default\nDefault=1\n",
  );
  const p = findProfile({ home: h });
  assert.equal(p.dir, path.join(root, "d.default"));
  assert.equal(p.name, "default");
});

test("an [Install...] Default= entry wins over Default=1", () => {
  const { h, root } = home(
    "[Install4F96D1932A9F858E]\nDefault=i.release\nLocked=1\n\n[Profile0]\nName=default\nIsRelative=1\nPath=d.default\nDefault=1\n\n[Profile1]\nName=release\nIsRelative=1\nPath=i.release\n",
  );
  assert.equal(findProfile({ home: h }).dir, path.join(root, "i.release"));
});

test("an absolute path is used as is", () => {
  const { h } = home("[Profile0]\nName=x\nIsRelative=0\nPath=/srv/ff/prof\nDefault=1\n");
  assert.equal(findProfile({ home: h }).dir, "/srv/ff/prof");
});

test("falls back to ~/.mozilla/firefox when there is no snap profile", () => {
  const { h, root } = home("[Profile0]\nName=default\nIsRelative=1\nPath=p.default\nDefault=1\n", { snap: false });
  assert.equal(findProfile({ home: h }).dir, path.join(root, "p.default"));
});

test("an explicit directory override is used without profiles.ini", () => {
  const h = mkdtempSync(path.join(os.tmpdir(), "golinks-home-"));
  const dir = mkdtempSync(path.join(os.tmpdir(), "golinks-prof-"));
  assert.equal(findProfile({ home: h, override: dir }).dir, dir);
});

test("an override that is not a directory is a clear error", () => {
  assert.throws(
    () => findProfile({ home: "/nonexistent", override: "/nonexistent/prof" }),
    /profile directory .* does not exist/,
  );
});

test("no profiles.ini anywhere is a clear error that names where it looked", () => {
  const h = mkdtempSync(path.join(os.tmpdir(), "golinks-home-"));
  assert.throws(
    () => findProfile({ home: h }),
    /No Firefox profile found.*snap\/firefox\/common\/\.mozilla\/firefox\/profiles\.ini/s,
  );
});

test("runningPid reads the pid from the profile lock symlink", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "golinks-prof-"));
  assert.equal(runningPid(dir), null);
  symlinkSync(`127.0.1.1:+${process.pid}`, path.join(dir, "lock"));
  assert.equal(runningPid(dir), process.pid);
});

test("runningPid ignores a stale lock whose process is gone", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "golinks-prof-"));
  symlinkSync("127.0.1.1:+999999999", path.join(dir, "lock"));
  assert.equal(runningPid(dir), null);
});
