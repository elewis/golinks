#!/usr/bin/env node
// Installs ./firefox/ as a temporary add-on into a running (or freshly
// launched) Firefox over its remote debugging protocol. Run it again after an
// edit to reload the add-on. See the "Dev loader" section of CLAUDE.md.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { applyPrefs, missingPrefs } from "./lib/prefs.mjs";
import { findProfile, runningPid } from "./lib/profiles.mjs";
import { RdpClient } from "./lib/rdp.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PORT = 6005;

const HELP = `Usage: pnpm load:firefox [options]

Installs firefox/ as a temporary add-on. Run it again to reload after an edit.

  --profile <dir>   Firefox profile directory   (env GOLINKS_FF_PROFILE; default: profiles.ini default)
  --port <n>        debugger server port        (env GOLINKS_FF_PORT; default: ${DEFAULT_PORT})
  --addon <dir>     add-on directory            (default: firefox/ in this repo)
  --binary <path>   Firefox executable          (env GOLINKS_FF_BIN; default: /snap/bin/firefox, else firefox)
  --set-prefs       allow adding the debugger prefs to the profile's user.js without asking
  --restart         allow quitting a running Firefox that has no debugger server, without asking
  --headless        launch Firefox headless (used by the tests)
  -h, --help        show this help

Without --set-prefs / --restart the script asks on the terminal; with no terminal it refuses.`;

class UserError extends Error {}

export async function run({ argv, env = process.env, stdin = process.stdin, stdout = process.stdout, stderr = process.stderr }) {
  const say = (s = "") => stdout.write(`${s}\n`);
  let args;
  try {
    ({ values: args } = parseArgs({
      args: argv,
      options: {
        profile: { type: "string" },
        port: { type: "string" },
        addon: { type: "string" },
        binary: { type: "string" },
        "set-prefs": { type: "boolean" },
        restart: { type: "boolean" },
        headless: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (e) {
    stderr.write(`${e.message}\n\n${HELP}\n`);
    return 2;
  }
  if (args.help) {
    say(HELP);
    return 0;
  }

  /** Ask y/N on the terminal; `flag` answers yes in advance. No terminal means no. */
  async function consent(flag, question) {
    if (flag) return true;
    if (!stdin.isTTY) return false;
    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
      return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
    } finally {
      rl.close();
    }
  }

  try {
    const port = Number(args.port ?? env.GOLINKS_FF_PORT ?? DEFAULT_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new UserError(`Invalid port: ${args.port ?? env.GOLINKS_FF_PORT}`);
    const addonDir = path.resolve(args.addon ?? path.join(REPO, "firefox"));
    if (!existsSync(path.join(addonDir, "manifest.json"))) throw new UserError(`No manifest.json in ${addonDir}.`);
    const addonId = JSON.parse(readFileSync(path.join(addonDir, "manifest.json"), "utf8")).browser_specific_settings?.gecko?.id;
    const profile = findProfile({ home: os.homedir(), override: args.profile ?? env.GOLINKS_FF_PROFILE });

    // 1. The normal edit-reload loop: Firefox already has the debugger server up.
    let client = await tryConnect(port);
    if (!client) {
      // 2/3. Not reachable: start, or restart, Firefox with the server.
      const pid = runningPid(profile.dir);
      const prefs = missingPrefs(profile.dir);
      say(`Profile: ${profile.dir}`);
      if (prefs.length > 0) {
        say("The debugger server needs these prefs, which this profile does not have:");
        for (const p of prefs) say(`  ${p.name} = ${p.value}   (${p.why})`);
        say("While the server runs, any program on this computer can connect to port " + port + " and fully control Firefox.");
        if (!(await consent(args["set-prefs"], `Add them to ${path.join(profile.dir, "user.js")}?`))) {
          throw new UserError("Not changing the profile. Re-run with --set-prefs (or answer y) to allow it.");
        }
      }
      if (pid) {
        say(`Firefox is running (pid ${pid}) without a debugger server on port ${port}.`);
        warnAboutSessionRestore(profile.dir, say);
        if (!(await consent(args.restart, "Quit it and relaunch it with the debugger server?"))) {
          throw new UserError("Not restarting Firefox. Re-run with --restart (or answer y) to allow it.");
        }
        await quit(pid, profile.dir);
      }
      const written = applyPrefs(profile.dir, prefs);
      if (written.length > 0) {
        say(`Added to ${path.join(profile.dir, "user.js")}:`);
        for (const l of written) say(`  ${l}`);
      }
      client = await launch({ binary: args.binary ?? env.GOLINKS_FF_BIN, profileDir: profile.dir, port, headless: args.headless });
    }

    try {
      const addon = await client.installTemporaryAddon(addonDir);
      const listed = (await client.listAddons()).find((a) => a.id === (addon?.id ?? addonId));
      if (!listed?.temporary) throw new UserError(`Firefox accepted the install but does not list ${addonId} as a temporary add-on.`);
      say(`Loaded ${listed.name} (${listed.id}) from ${addonDir}`);
    } finally {
      client.close();
    }
    return 0;
  } catch (e) {
    stderr.write(`${e instanceof UserError ? "" : "Unexpected error: "}${e.message}\n`);
    return 1;
  }

  /** Connected client, or null when nothing listens. Something else on the port is an error. */
  async function tryConnect(p) {
    try {
      return await RdpClient.connect(p);
    } catch (e) {
      if (e.code === "ECONNREFUSED") return null;
      throw new UserError(`Port ${p} is in use by something that is not Firefox's debugger server (${e.message}). Pick another with --port.`);
    }
  }

  async function quit(pid, profileDir) {
    say(`Quitting Firefox (pid ${pid}) with SIGTERM, which is a normal shutdown...`);
    process.kill(pid, "SIGTERM");
    for (let i = 0; i < 300; i++) {
      if (runningPid(profileDir) === null) return;
      await sleep(200);
    }
    throw new UserError(`Firefox (pid ${pid}) did not quit within 60 s; not forcing it. Close it yourself and re-run.`);
  }

  async function launch({ binary, profileDir, port: p, headless }) {
    const exe = binary ?? (existsSync("/snap/bin/firefox") ? "/snap/bin/firefox" : "firefox");
    const flags = ["--no-remote", "--profile", profileDir, "--start-debugger-server", String(p)];
    if (headless) flags.unshift("--headless");
    say(`Launching ${exe} with the debugger server on 127.0.0.1:${p}...`);
    const child = spawn(exe, flags, { detached: true, stdio: "ignore" });
    let exitCode;
    child.once("exit", (c) => (exitCode = c ?? -1));
    child.once("error", (e) => (exitCode = e.message));
    child.unref();
    for (let i = 0; i < 300; i++) {
      if (exitCode !== undefined) {
        // The snap launcher may exit while the real Firefox keeps running; only a pre-listen failure is fatal.
        if (typeof exitCode === "string" || exitCode !== 0) throw new UserError(`${exe} failed to start (${exitCode}).`);
      }
      const c = await tryConnect(p);
      if (c) return c;
      await sleep(200);
    }
    throw new UserError(`Firefox did not open the debugger server on port ${p} within 60 s.`);
  }
}

function warnAboutSessionRestore(profileDir, say) {
  let startupPage = 1;
  try {
    startupPage = Number(/user_pref\("browser\.startup\.page",\s*(\d+)\)/.exec(readFileSync(path.join(profileDir, "prefs.js"), "utf8"))?.[1] ?? 1);
  } catch {}
  if (startupPage !== 3) {
    say(`Note: browser.startup.page is ${startupPage}, not 3, so Firefox may not reopen your tabs on its own after this restart`);
    say("(History > Restore Previous Session brings them back).");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await run({ argv: process.argv.slice(2) });
}
