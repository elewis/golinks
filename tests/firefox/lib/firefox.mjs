// Headless Firefox driven through a private geckodriver process, using raw
// WebDriver over HTTP (built-in fetch only, no third-party packages).
import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { freePort } from "../../lib/net.mjs";

const GECKODRIVER = "/snap/bin/geckodriver";

// network.dns.localDomains=go makes the `go` host resolve so the
// declarativeNetRequest redirect can fire. The devtools.console.stdout prefs
// send the background page's console output to geckodriver's debug log.
const PREFS = {
  "network.dns.localDomains": "go",
  "devtools.console.stdout.chrome": true,
  "devtools.console.stdout.content": true,
  "extensions.logging.enabled": true,
  "browser.fixup.fallback-to-https": false,
  "network.proxy.type": 0,
};

// Every geckodriver we start is killed (with the Firefox it spawned) on exit,
// Ctrl-C or SIGTERM, even if a test run dies halfway.
const live = new Set();
function killAll() {
  for (const child of live) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }
  live.clear();
}
process.on("exit", killAll);
for (const [sig, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.on(sig, () => {
    killAll();
    process.exit(code);
  });
}

export class Firefox {
  constructor(logPath) {
    this.logPath = logPath;
  }

  async start() {
    this.port = await freePort();
    const wsPort = await freePort();
    const logFd = openSync(this.logPath, "w");
    // detached = own process group, so killing the group also kills Firefox.
    this.proc = spawn(
      GECKODRIVER,
      ["--port", String(this.port), "--websocket-port", String(wsPort), "--log", "debug"],
      { stdio: ["ignore", logFd, logFd], detached: true },
    );
    closeSync(logFd);
    live.add(this.proc);
    this.exited = new Promise((resolve) => this.proc.once("exit", resolve));

    const deadline = Date.now() + 15_000;
    for (;;) {
      try {
        await this.#http("GET", "/status");
        break;
      } catch (e) {
        if (this.proc.exitCode !== null) throw new Error(`geckodriver exited; see ${this.logPath}`);
        if (Date.now() > deadline) throw new Error("geckodriver did not become ready");
        await sleep(100);
      }
    }
    // Omit `binary`: /usr/bin/firefox is a wrapper script geckodriver rejects.
    const { sessionId } = await this.#http("POST", "/session", {
      capabilities: {
        alwaysMatch: {
          // Pages navigate away on their own, so don't wait for load events.
          pageLoadStrategy: "none",
          "moz:firefoxOptions": { args: ["-headless"], prefs: PREFS },
        },
      },
    });
    this.session = sessionId;
  }

  async stop() {
    if (!this.proc) return;
    try {
      if (this.session) await this.#http("DELETE", `/session/${this.session}`, undefined, 10_000);
    } catch {}
    try {
      process.kill(-this.proc.pid, "SIGTERM");
    } catch {}
    const timedOut = await Promise.race([this.exited.then(() => false), sleep(5000).then(() => true)]);
    if (timedOut) {
      try {
        process.kill(-this.proc.pid, "SIGKILL");
      } catch {}
      await this.exited;
    }
    live.delete(this.proc);
    this.proc = null;
  }

  async #http(method, path, body, timeout = 30_000) {
    const res = await fetch(`http://127.0.0.1:${this.port}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(payload)}`);
    return payload.value ?? payload;
  }

  #s(path) {
    return `/session/${this.session}${path}`;
  }

  installAddon(path) {
    return this.#http("POST", this.#s("/moz/addon/install"), { path, temporary: true });
  }
  get(url) {
    return this.#http("POST", this.#s("/url"), { url });
  }
  /** Click the first element matching a CSS selector in the current page (a real WebDriver click). */
  async click(selector) {
    const el = await this.#http("POST", this.#s("/element"), { using: "css selector", value: selector });
    const id = Object.values(el)[0];
    return this.#http("POST", this.#s(`/element/${id}/click`), {});
  }
  currentUrl() {
    return this.#http("GET", this.#s("/url"));
  }
  title() {
    return this.#http("GET", this.#s("/title"));
  }

  /** Poll `read()` until predicate(value) holds; returns the last value seen. */
  async waitFor(read, predicate, timeout = 8000) {
    const deadline = Date.now() + timeout;
    let value = "";
    while (Date.now() < deadline) {
      try {
        value = await read();
      } catch {
        value = "";
      }
      if (value && predicate(value)) return value;
      await sleep(100);
    }
    return value;
  }

  waitUrl(predicate, timeout) {
    return this.waitFor(() => this.currentUrl(), predicate, timeout);
  }

  log() {
    return readFileSync(this.logPath, "utf8");
  }

  async waitLog(text, timeout = 20_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (this.log().includes(text)) return true;
      await sleep(200);
    }
    return false;
  }
}
