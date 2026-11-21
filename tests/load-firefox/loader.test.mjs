// Integration test for `pnpm load:firefox`. Everything happens in a throwaway
// profile under tests/load-firefox/.build/ (git-ignored; snap Firefox cannot
// read /tmp) with headless Firefox on a free port. It never uses a real profile
// and only signals pids it read from its own profile's lock file.
//
// Firefox shows its "remote controlled" look (the `remotecontrol` attribute on
// the browser window) for as long as a debugger socket listens, so a loader that
// leaves the server open leaves the browser in that state. A chrome-side
// observer, armed by the test, logs the attribute on every socket change.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "../../scripts/build.mts";
import { RdpClient } from "../../scripts/lib/rdp.mts";
import { applyPrefs, missingPrefs, removePrefs } from "../../scripts/lib/prefs.mts";
import { runningPid } from "../../scripts/lib/profiles.mts";
import { freePort } from "../lib/net.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LOADER = path.join(REPO, "scripts/load-firefox.mts");
const ROOT = path.join(REPO, "tests/load-firefox/.build", `${process.pid}-${randomBytes(3).toString("hex")}`);
const PROFILE = path.join(ROOT, "profile");
const ADDON = path.join(ROOT, "ext");
const ID = "golinks@ethanlew.is";

let port;
let hitPort;
const hits = [];
let hitServer;
const FIREFOX = process.env.GOLINKS_FF_BIN || "/snap/bin/firefox";
const CUE_LOG = path.join(ROOT, "cue.log");

/** The temporary add-on tells this server its name when its background page starts, so we can see it really runs. */
function writeAddon(name) {
  const manifestFile = path.join(ADDON, "manifest.json");
  const m = JSON.parse(readFileSync(manifestFile, "utf8"));
  m.name = name;
  if (!m.background.scripts.includes("loadertest.js")) m.background.scripts.unshift("loadertest.js");
  writeFileSync(manifestFile, JSON.stringify(m, null, 2));
  writeFileSync(
    path.join(ADDON, "loadertest.js"),
    `fetch("http://127.0.0.1:${hitPort}/loaded?name=" + encodeURIComponent(browser.runtime.getManifest().name), { mode: "no-cors" }).catch(() => {});\n`,
  );
}

/** Names the add-on reported after the first `since` hits. */
async function loadedNames(since) {
  for (let i = 0; i < 100 && hits.length <= since; i++) await sleep(100);
  return hits.slice(since);
}

function loader(...extra) {
  const args = [LOADER, "--profile", PROFILE, "--port", String(port), "--addon", ADDON, "--headless", ...extra];
  return new Promise((resolve) =>
    execFile(process.execPath, args, { timeout: 120_000, env: { ...process.env, GOLINKS_FF_PROFILE: "", GOLINKS_FF_PORT: "" } }, (err, stdout, stderr) =>
      resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr }),
    ),
  );
}

function accepts(p) {
  return new Promise((resolve) => {
    const s = net.connect({ port: p, host: "127.0.0.1" });
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
  });
}

const READ_CUE = `String(Services.wm.getMostRecentWindow("navigator:browser")?.document.documentElement.getAttribute("remotecontrol"))`;

/** Chrome-side: log the window's `remotecontrol` attribute now and on every debugger socket change. */
const ARM = `(function () {
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const log = () => IOUtils.writeUTF8(${JSON.stringify(CUE_LOG)}, String(w.document.documentElement.getAttribute("remotecontrol")) + "\\n", { mode: "appendOrCreate" });
  // Observers run in no promised order, so read the attribute after all of them have run.
  Services.obs.addObserver(() => Services.tm.dispatchToMainThread(log), "devtools-socket");
  log();
  return "armed";
})()`;

async function cueLog() {
  await sleep(500); // the file write is asynchronous
  return existsSync(CUE_LOG) ? readFileSync(CUE_LOG, "utf8").trim().split("\n") : [];
}

async function stopFirefox() {
  const pid = runningPid(PROFILE);
  if (!pid) return;
  process.kill(pid, "SIGTERM");
  for (let i = 0; i < 100 && runningPid(PROFILE); i++) await sleep(200);
  const left = runningPid(PROFILE);
  if (left) process.kill(left, "SIGKILL");
}

async function waitForFirefox() {
  for (let i = 0; i < 150 && !runningPid(PROFILE); i++) await sleep(200);
  return runningPid(PROFILE);
}

before(async () => {
  port = await freePort();
  hitServer = http.createServer((req, res) => {
    hits.push(new URL(req.url, "http://x").searchParams.get("name"));
    res.end("ok");
  });
  await new Promise((r) => hitServer.listen(0, "127.0.0.1", r));
  hitPort = hitServer.address().port;
  mkdirSync(PROFILE, { recursive: true });
  build("firefox", ADDON);
  writeAddon("GoLinks loader test v1");
});
after(async () => {
  await stopFirefox();
  hitServer.close();
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

test("launches Firefox, sets the prefs, installs the add-on and leaves no debugger server listening", async () => {
  const r = await loader("--set-prefs");
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /user_pref\("devtools\.debugger\.remote-enabled", true\);/);
  assert.match(r.stdout, /Loaded GoLinks loader test v1/);
  assert.ok(runningPid(PROFILE), "Firefox should be running on the profile");
  assert.deepEqual(await loadedNames(0), ["GoLinks loader test v1"], "the add-on's background page should be running");
  assert.equal(await accepts(port), false, "the debugger port must be closed once the add-on is installed");
});

test("nothing about the debugger prefs persists in the profile after Firefox quits", async () => {
  const names = ["devtools.debugger.remote-enabled", "devtools.debugger.prompt-connection", "devtools.chrome.enabled"];
  const files = () => ["user.js", "prefs.js"].map((f) => (existsSync(path.join(PROFILE, f)) ? readFileSync(path.join(PROFILE, f), "utf8") : ""));
  assert.ok(runningPid(PROFILE), "Firefox from the previous test should still be running");
  // Right after the loader returns, with no waiting: Firefox's startup save put the prefs into prefs.js,
  // and the loader must have saved them out again itself (a debounced save would not be done yet).
  const [userJs, running] = files();
  for (const n of names) assert.ok(!userJs.includes(n), `user.js must not keep ${n} while Firefox runs`);
  for (const n of names) assert.ok(!running.includes(n), `prefs.js must not hold ${n} once the loader has returned`);
  await stopFirefox();
  for (const [i, text] of files().entries()) {
    for (const n of names) assert.ok(!text.includes(n), `${["user.js", "prefs.js"][i]} must not contain ${n} after Firefox quit`);
  }
});

test("the browser window is not left in remote-control state", async () => {
  // Firefox running with the debugger server open (what the loader's launch
  // leaves behind on the old code), with the window's cue logged from before
  // the loader runs.
  await stopFirefox();
  const prefLines = applyPrefs(PROFILE, missingPrefs(PROFILE));
  const open = spawn(FIREFOX, ["--headless", "--no-remote", "--profile", PROFILE, "--start-debugger-server", String(port)], { detached: true, stdio: "ignore" });
  open.unref();
  assert.ok(await waitForFirefox(), "Firefox should start");
  removePrefs(PROFILE, prefLines, true); // read at startup; nothing needs to stay in the file
  let client;
  for (let i = 0; i < 100 && !client; i++) client = await RdpClient.connect(port).catch(() => sleep(200).then(() => null));
  assert.ok(client, "the debugger server should come up");
  // The window sets the cue once it has loaded; wait for that before logging.
  for (let i = 0; i < 100 && (await client.evaluateChrome(READ_CUE)) !== "true"; i++) await sleep(200);
  await client.evaluateChrome(ARM);
  client.close();
  assert.deepEqual(await cueLog(), ["true"], "an open debugger socket sets the cue; that is the state under test");

  const seen = hits.length;
  const pidBefore = runningPid(PROFILE);
  writeAddon("GoLinks loader test v2");
  const r = await loader();
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(runningPid(PROFILE), pidBefore, "the reload must not restart Firefox");
  assert.deepEqual(await loadedNames(seen), ["GoLinks loader test v2"]);
  assert.deepEqual(await cueLog(), ["true", "null"], "the window must lose its remote-control state");
  assert.equal(await accepts(port), false, "the debugger port must be closed");
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
  const plain = spawn(FIREFOX, ["--headless", "--no-remote", "--profile", PROFILE], { detached: true, stdio: "ignore" });
  plain.unref();
  const pid = await waitForFirefox();
  assert.ok(pid, "plain Firefox should be running");

  // Headless Firefox has no remoting, so a forwarded "open the server" command would only start a
  // second Firefox. The loader must see that and go straight to asking, without spawning one.
  const started = Date.now();
  const refused = await loader();
  assert.ok(Date.now() - started < 5_000, `falling back took ${Date.now() - started} ms`);
  assert.match(refused.stdout, /cannot take a forwarded command/);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /--restart/);
  assert.equal(runningPid(PROFILE), pid, "Firefox must not be touched without consent");

  const seen = hits.length;
  writeAddon("GoLinks loader test v3");
  const ok = await loader("--restart");
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  assert.notEqual(runningPid(PROFILE), pid);
  assert.ok(runningPid(PROFILE));
  assert.deepEqual(await loadedNames(seen), ["GoLinks loader test v3"]);
  assert.equal(await accepts(port), false, "the debugger port must be closed");
});
