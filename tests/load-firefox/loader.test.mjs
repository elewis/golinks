// Integration test for `pnpm load:firefox`. Everything happens in a throwaway
// profile under tests/load-firefox/.build/ (git-ignored; snap Firefox cannot
// read /tmp) with headless Firefox on a free port. It never uses a real profile
// and only signals pids it read from its own profile's lock file.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { RdpClient } from "../../scripts/lib/rdp.mjs";
import { runningPid } from "../../scripts/lib/profiles.mjs";
import { freePort } from "../lib/net.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LOADER = path.join(REPO, "scripts/load-firefox.mjs");
const ROOT = path.join(REPO, "tests/load-firefox/.build", `${process.pid}-${randomBytes(3).toString("hex")}`);
const PROFILE = path.join(ROOT, "profile");
const ADDON = path.join(ROOT, "ext");
const ID = "golinks@ethanlew.is";

let port;

function setName(name) {
  const file = path.join(ADDON, "manifest.json");
  const m = JSON.parse(readFileSync(file, "utf8"));
  m.name = name;
  writeFileSync(file, JSON.stringify(m, null, 2));
}

function loader(...extra) {
  const args = [LOADER, "--profile", PROFILE, "--port", String(port), "--addon", ADDON, "--headless", ...extra];
  return new Promise((resolve) =>
    execFile(process.execPath, args, { timeout: 120_000, env: { ...process.env, GOLINKS_FF_PROFILE: "", GOLINKS_FF_PORT: "" } }, (err, stdout, stderr) =>
      resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr }),
    ),
  );
}

async function addonNames() {
  const client = await RdpClient.connect(port);
  try {
    return (await client.listAddons()).filter((a) => a.id === ID).map((a) => a.name);
  } finally {
    client.close();
  }
}

async function stopFirefox() {
  const pid = runningPid(PROFILE);
  if (!pid) return;
  process.kill(pid, "SIGTERM");
  for (let i = 0; i < 100 && runningPid(PROFILE); i++) await sleep(200);
  const left = runningPid(PROFILE);
  if (left) process.kill(left, "SIGKILL");
}

before(async () => {
  port = await freePort();
  mkdirSync(PROFILE, { recursive: true });
  cpSync(path.join(REPO, "firefox"), ADDON, { recursive: true });
  setName("GoLinks loader test v1");
});
after(async () => {
  await stopFirefox();
  rmSync(ROOT, { recursive: true, force: true });
});

test("refuses to change the profile or launch anything without consent", async () => {
  const r = await loader();
  assert.equal(r.code, 1);
  assert.match(r.stderr, /--set-prefs/);
  assert.match(r.stdout, /devtools\.debugger\.remote-enabled = true/);
  assert.equal(existsSync(path.join(PROFILE, "user.js")), false);
  assert.equal(runningPid(PROFILE), null);
});

test("launches Firefox, sets the prefs, prints what it changed and installs the add-on", async () => {
  const r = await loader("--set-prefs");
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /user_pref\("devtools\.debugger\.remote-enabled", true\);/);
  assert.match(r.stdout, /Loaded GoLinks loader test v1/);
  assert.ok(runningPid(PROFILE), "Firefox should be running on the profile");
  assert.deepEqual(await addonNames(), ["GoLinks loader test v1"]);
});

test("rerunning reloads the add-on in the same Firefox, without a restart", async () => {
  const before = runningPid(PROFILE);
  setName("GoLinks loader test v2");
  const r = await loader();
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /Launching|Quitting/);
  assert.equal(runningPid(PROFILE), before);
  assert.deepEqual(await addonNames(), ["GoLinks loader test v2"]);
});

test("a port held by something else is a clear error", async () => {
  await stopFirefox();
  const server = net.createServer((s) => s.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  try {
    const r = await loader();
    assert.equal(r.code, 1);
    assert.match(r.stderr, new RegExp(`Port ${port} is in use by something that is not Firefox`));
    assert.equal(runningPid(PROFILE), null);
  } finally {
    server.close();
  }
});

test("a running Firefox without the server is left alone unless --restart is given", async () => {
  const plain = spawn("/snap/bin/firefox", ["--headless", "--no-remote", "--profile", PROFILE], { detached: true, stdio: "ignore" });
  plain.unref();
  for (let i = 0; i < 100 && !runningPid(PROFILE); i++) await sleep(200);
  const pid = runningPid(PROFILE);
  assert.ok(pid, "plain Firefox should be running");

  const refused = await loader();
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /--restart/);
  assert.equal(runningPid(PROFILE), pid, "Firefox must not be touched without consent");

  const ok = await loader("--restart");
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  assert.notEqual(runningPid(PROFILE), pid);
  assert.ok(runningPid(PROFILE));
  assert.deepEqual(await addonNames(), ["GoLinks loader test v2"]);
});
