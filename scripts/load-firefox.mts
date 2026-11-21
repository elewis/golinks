#!/usr/bin/env node
// Installs ./firefox/ as a temporary add-on into a running (or freshly
// launched) Firefox over its remote debugging protocol. Run it again after an
// edit to reload the add-on. The debugger server is only open while the install
// runs: it is closed afterwards, because an open server makes Firefox show its
// "remote controlled" look. See the "Dev loader" section of CLAUDE.md.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "./build.mts";
import {
  applyPrefs,
  conflictingPrefs,
  existingPrefs,
  missingPrefs,
  movePrefsScript,
  removePrefs,
} from "./lib/prefs.mts";
import { acceptsForwardedCommands, findProfile, runningPid } from "./lib/profiles.mts";
import { RdpClient } from "./lib/rdp.mts";

const DEFAULT_PORT = 6005;

const HELP = `Usage: pnpm load:firefox [options]

Builds dist/firefox/ and installs it as a temporary add-on. Run it again to reload after an edit.

  --profile <dir>   Firefox profile directory   (env GOLINKS_FF_PROFILE; default: profiles.ini default)
  --port <n>        debugger server port        (env GOLINKS_FF_PORT; default: ${DEFAULT_PORT})
  --addon <dir>     add-on directory            (default: build dist/firefox/ from this repo)
  --binary <path>   Firefox executable          (env GOLINKS_FF_BIN; default: /snap/bin/firefox, else firefox)
  --set-prefs       allow adding the debugger prefs to the profile's user.js without asking
  --restart         allow quitting a running Firefox that has no debugger server, without asking
  --headless        launch Firefox headless and isolated with --no-remote (used by the tests)
  -h, --help        show this help

Without --set-prefs / --restart the script asks on the terminal; with no terminal it refuses.`;

class UserError extends Error {}

export interface RunOptions {
  argv: string[];
  env?: NodeJS.ProcessEnv;
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

interface LaunchOptions {
  binary: string | undefined;
  profileDir: string;
  port: number;
  headless: boolean | undefined;
}

export async function run({
  argv,
  env = process.env,
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
}: RunOptions): Promise<number> {
  const say = (s = ""): void => void stdout.write(`${s}\n`);
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
    stderr.write(`${(e as Error).message}\n\n${HELP}\n`);
    return 2;
  }
  if (args.help) {
    say(HELP);
    return 0;
  }

  /** Ask y/N on the terminal; `flag` answers yes in advance. No terminal means no. */
  async function consent(flag: boolean | undefined, question: string): Promise<boolean> {
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
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new UserError(`Invalid port: ${args.port ?? env.GOLINKS_FF_PORT}`);
    // Default: build common/ + firefox/ into dist/firefox first, so a rerun reloads fresh code.
    // An explicit --addon directory is installed as it is.
    const addonDir = args.addon ? path.resolve(args.addon) : build("firefox");
    if (!existsSync(path.join(addonDir, "manifest.json"))) throw new UserError(`No manifest.json in ${addonDir}.`);
    const addonId = JSON.parse(readFileSync(path.join(addonDir, "manifest.json"), "utf8")).browser_specific_settings
      ?.gecko?.id;
    const profile = findProfile({ home: os.homedir(), override: args.profile ?? env.GOLINKS_FF_PROFILE });

    // 1. Firefox already has the debugger server open: install, then close it.
    let client: RdpClient | null = await tryConnect(port);
    if (!client) {
      const pid = runningPid(profile.dir);
      say(`Profile: ${profile.dir}`);
      // 2. Firefox is running: ask it to open the server again, no restart. This works when the
      //    prefs are already in force in that session (an earlier run of this script put them there).
      if (pid && acceptsForwardedCommands(pid)) {
        say(
          `Firefox is running (pid ${pid}); asking it to open the debugger server on port ${port} for the install...`,
        );
        client = await reopen({
          binary: args.binary ?? env.GOLINKS_FF_BIN,
          profileDir: profile.dir,
          port,
          headless: args.headless,
        });
        if (client && runningPid(profile.dir) !== pid) {
          client.close();
          throw new UserError(
            `Firefox's pid changed from ${pid} to ${runningPid(profile.dir)} while reopening the debugger server; not installing. Check for a second Firefox on this profile.`,
          );
        }
        if (!client) say("It did not open the server (the debugger prefs are probably not in force in that session).");
      } else if (pid) {
        say(
          `Firefox is running (pid ${pid}) but cannot take a forwarded command (started with --no-remote or headless, or not readable).`,
        );
      }
      // 3. Otherwise start, or restart, Firefox with the server.
      if (!client) {
        const conflicts = conflictingPrefs(profile.dir);
        if (conflicts.length > 0) {
          throw new UserError(
            `This profile sets ${conflicts.map((p) => `${p.name} = ${!p.value}`).join(", ")}; the loader will not override that. Remove the line or set it to ${conflicts.map((p) => p.value).join(", ")} yourself.`,
          );
        }
        const kept = existingPrefs(profile.dir);
        if (kept.length > 0) {
          say(
            `These prefs are already set in your profile (by you, or by an earlier version of this script) and are left as they are:`,
          );
          for (const p of kept) say(`  ${p.name} = ${p.value}`);
          say("To remove them, delete those lines from user.js and prefs.js while Firefox is not running.");
        }
        const prefs = missingPrefs(profile.dir);
        if (prefs.length > 0) {
          say("The debugger server needs these prefs. They are set only for this run: written to user.js for startup,");
          say(
            "removed again as soon as Firefox is up, and moved to Firefox's defaults so they are never saved. A restart of Firefox drops them.",
          );
          for (const p of prefs) say(`  ${p.name} = ${p.value}   (${p.why})`);
          say(
            "While the server is open (only during the install), any program on this computer can connect to port " +
              port +
              " and fully control Firefox.",
          );
          if (!(await consent(args["set-prefs"], `Set them temporarily in ${path.join(profile.dir, "user.js")}?`))) {
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
        const userJs = path.join(profile.dir, "user.js");
        const created = !existsSync(userJs);
        const written = applyPrefs(profile.dir, prefs);
        if (written.length > 0) say(`Temporarily added to ${userJs}:`);
        for (const l of written) say(`  ${l}`);
        const undo = () => removePrefs(profile.dir, written, created);
        const onSignal = (sig: NodeJS.Signals) => (undo(), process.kill(process.pid, sig));
        process.once("SIGINT", onSignal);
        process.once("SIGTERM", onSignal);
        try {
          client = await launch({
            binary: args.binary ?? env.GOLINKS_FF_BIN,
            profileDir: profile.dir,
            port,
            headless: args.headless,
          });
          // Firefox has read user.js by now: keep the values for this session only.
          if (prefs.length > 0) await client.evaluateChrome(movePrefsScript(prefs));
        } catch (e) {
          // Never leave the server open behind a failure.
          if (client) await client.closeServer().catch(() => client!.close());
          throw e;
        } finally {
          undo();
          process.off("SIGINT", onSignal);
          process.off("SIGTERM", onSignal);
        }
        if (written.length > 0) say(`Removed them from ${userJs} again; they now live only in this Firefox session.`);
      }
    }

    let failure: unknown;
    try {
      const addon = await client!.installTemporaryAddon(addonDir);
      const listed = (await client!.listAddons()).find((a) => a.id === (addon?.id ?? addonId));
      if (!listed?.temporary)
        throw new UserError(`Firefox accepted the install but does not list ${addonId} as a temporary add-on.`);
      say(`Loaded ${listed.name} (${listed.id}) from ${addonDir}`);
    } catch (e) {
      failure = e;
    }
    // Always close the server, even after a failed install, so Firefox is never left remote controlled.
    try {
      await closeServer(client!, port, say);
    } catch (e) {
      if (!failure) throw e;
      stderr.write(`${(e as Error).message}\n`);
    }
    if (failure) throw failure;
    return 0;
  } catch (e) {
    stderr.write(`${e instanceof UserError ? "" : "Unexpected error: "}${(e as Error).message}\n`);
    return 1;
  }

  /** Connected client, or null when nothing listens. Something else on the port is an error. */
  async function tryConnect(p: number): Promise<RdpClient | null> {
    try {
      return await RdpClient.connect(p);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ECONNREFUSED") return null;
      throw new UserError(
        `Port ${p} is in use by something that is not Firefox's debugger server (${(e as Error).message}). Pick another with --port.`,
      );
    }
  }

  /** Close Firefox's debugger server so it is not remote controlled; say so loudly if that fails. */
  async function closeServer(client: RdpClient, p: number, say: (s?: string) => void): Promise<void> {
    try {
      await client.closeServer();
    } catch (e) {
      client.close();
      throw new UserError(
        `Could not close the debugger server on port ${p} (${(e as Error).message}). Firefox stays remote controlled until you restart it.`,
      );
    }
    for (let i = 0; i < 25; i++) {
      const again = await tryConnect(p);
      if (!again) {
        say(`Closed the debugger server on port ${p}; Firefox is no longer remote controlled.`);
        return;
      }
      again.close();
      await sleep(200);
    }
    throw new UserError(
      `The debugger server on port ${p} is still open. Firefox stays remote controlled until you restart it.`,
    );
  }

  /**
   * Ask the Firefox already running on this profile to open the server, via a forwarded command line.
   * A Firefox that takes it makes the child exit at once with the server up. One that does not (started
   * with --no-remote, or headless) makes the child exit at once too, with a message, so a few more
   * seconds of polling after the exit is all the wait needed. The child gets its own process group so
   * a straggler (the snap wrapper) can be killed whole.
   */
  async function reopen({ binary, profileDir, port: p, headless }: LaunchOptions): Promise<RdpClient | null> {
    const exe = binary ?? (existsSync("/snap/bin/firefox") ? "/snap/bin/firefox" : "firefox");
    const flags = ["--profile", profileDir, "--start-debugger-server", String(p)];
    if (headless) flags.unshift("--headless");
    const child = spawn(exe, flags, { detached: true, stdio: "ignore" });
    let exited: number | null = null; // time of exit
    child.once("exit", () => (exited = Date.now()));
    child.once("error", () => (exited = Date.now()));
    const start = Date.now();
    try {
      for (;;) {
        const c = await tryConnect(p);
        if (c) return c;
        if (exited ? Date.now() - exited > 3000 : Date.now() - start > 15_000) return null;
        await sleep(200);
      }
    } finally {
      if (exited === null) {
        try {
          process.kill(-child.pid!);
        } catch {}
      }
    }
  }

  async function quit(pid: number, profileDir: string): Promise<void> {
    say(`Quitting Firefox (pid ${pid}) with SIGTERM, which is a normal shutdown...`);
    process.kill(pid, "SIGTERM");
    for (let i = 0; i < 300; i++) {
      if (runningPid(profileDir) === null) return;
      await sleep(200);
    }
    throw new UserError(`Firefox (pid ${pid}) did not quit within 60 s; not forcing it. Close it yourself and re-run.`);
  }

  async function launch({ binary, profileDir, port: p, headless }: LaunchOptions): Promise<RdpClient> {
    const exe = binary ?? (existsSync("/snap/bin/firefox") ? "/snap/bin/firefox" : "firefox");
    // A normal window keeps Firefox's remoting, so a later run can ask it to reopen the server and
    // links from other programs still reach it. Headless (the tests) must stay out of any other instance.
    const flags = ["--profile", profileDir, "--start-debugger-server", String(p)];
    if (headless) flags.unshift("--headless", "--no-remote");
    say(`Launching ${exe} with the debugger server on 127.0.0.1:${p}...`);
    const child = spawn(exe, flags, { detached: true, stdio: "ignore" });
    let exitCode: number | string | undefined;
    child.once("exit", (c) => (exitCode = c ?? -1));
    child.once("error", (e) => (exitCode = e.message));
    child.unref();
    for (let i = 0; i < 300; i++) {
      if (exitCode !== undefined) {
        // The snap launcher may exit while the real Firefox keeps running; only a pre-listen failure is fatal.
        if (typeof exitCode === "string" || exitCode !== 0)
          throw new UserError(`${exe} failed to start (${exitCode}).`);
      }
      const c = await tryConnect(p);
      if (c) return c;
      await sleep(200);
    }
    throw new UserError(`Firefox did not open the debugger server on port ${p} within 60 s.`);
  }
}

function warnAboutSessionRestore(profileDir: string, say: (s?: string) => void): void {
  let startupPage = 1;
  try {
    startupPage = Number(
      /user_pref\("browser\.startup\.page",\s*(\d+)\)/.exec(
        readFileSync(path.join(profileDir, "prefs.js"), "utf8"),
      )?.[1] ?? 1,
    );
  } catch {}
  if (startupPage !== 3) {
    say(
      `Note: browser.startup.page is ${startupPage}, not 3, so Firefox may not reopen your tabs on its own after this restart`,
    );
    say("(History > Restore Previous Session brings them back).");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await run({ argv: process.argv.slice(2) });
}
