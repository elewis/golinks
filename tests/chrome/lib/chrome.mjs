// Headless Google Chrome driven over the Chrome DevTools Protocol (built-in
// WebSocket only, no third-party packages).
//
// Branded Chrome ignores --load-extension, so the extension is installed with
// the CDP method Extensions.loadUnpacked, which needs
// --enable-unsafe-extension-debugging.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { freePort } from "../../lib/net.mjs";

const CHROME = "/usr/bin/google-chrome";

// Every Chrome we start is killed (the whole process group) on exit, Ctrl-C or
// SIGTERM, even if a test run dies halfway.
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
for (const [sig, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  process.on(sig, () => {
    killAll();
    process.exit(code);
  });
}

export class Chrome {
  constructor(userDataDir) {
    this.userDataDir = userDataDir;
    this.nextId = 0;
    this.pending = new Map();
    this.workerLogs = []; // console output and exceptions of the extension's service worker
    this.workerUrl = null;
    this.stderr = "";
    this.attached = []; // service workers paused at start, not yet released
  }

  async start() {
    const port = await freePort();
    // --host-resolver-rules makes the `go` host resolve to loopback so the
    // declarativeNetRequest redirect can fire (Chrome has no equivalent of
    // Firefox's network.dns.localDomains). Nothing listens there: the redirect
    // happens before a connection is made.
    const args = [
      "--headless=new",
      "--no-sandbox",
      "--no-first-run",
      "--disable-gpu",
      "--enable-unsafe-extension-debugging",
      "--host-resolver-rules=MAP go 127.0.0.1",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${this.userDataDir}`,
      "about:blank",
    ];
    // detached = own process group, so killing the group also kills helpers.
    this.proc = spawn(CHROME, args, { stdio: ["ignore", "ignore", "pipe"], detached: true });
    live.add(this.proc);
    this.exited = new Promise((resolve) => this.proc.once("exit", resolve));
    this.proc.stderr.on("data", (d) => (this.stderr += d));

    const deadline = Date.now() + 20_000;
    let wsUrl;
    while (!wsUrl) {
      if (this.proc.exitCode !== null) throw new Error(`Chrome exited early:\n${this.stderr}`);
      if (Date.now() > deadline) throw new Error(`Chrome did not expose DevTools:\n${this.stderr}`);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) });
        wsUrl = (await res.json()).webSocketDebuggerUrl;
      } catch {
        await sleep(100);
      }
    }
    this.ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error("DevTools WebSocket failed"));
    });
    this.ws.onmessage = (e) => this.#onMessage(JSON.parse(e.data));
  }

  #onMessage(msg) {
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === "Target.attachedToTarget") {
      const { sessionId, targetInfo } = msg.params;
      if (targetInfo.type === "service_worker") {
        this.attached.push({ sessionId, url: targetInfo.url });
        this.#settleWorkers();
      } else if (msg.params.waitingForDebugger) {
        // Auto-attach also pauses pages; only service workers are wanted paused.
        this.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
      }
    } else if (msg.method === "Fetch.requestPaused") {
      this.#stubRequest(msg.sessionId, msg.params);
    } else if (msg.method === "Runtime.consoleAPICalled" && msg.sessionId === this.workerSession) {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      this.workerLogs.push(`console.${msg.params.type}: ${text}`);
    } else if (msg.method === "Runtime.exceptionThrown" && msg.sessionId === this.workerSession) {
      const d = msg.params.exceptionDetails;
      this.workerLogs.push(`JavaScript error: ${d.exception?.description ?? d.text}`);
    }
  }

  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  // Release every paused service worker. Ours (known once loadExtension has
  // its id) gets console capture first; others (Chrome's own) just resume.
  async #settleWorkers() {
    if (!this.workerUrl) return;
    for (const { sessionId, url } of this.attached.splice(0)) {
      if (url === this.workerUrl) {
        this.workerSession = sessionId;
        await this.send("Runtime.enable", {}, sessionId);
      }
      await this.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
    }
  }

  /** Install the unpacked extension at `dir`; returns its id. */
  async loadExtension(dir) {
    // Pause new service workers at start so the extension's console is
    // captured from its very first line, including startup errors.
    await this.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    const { id } = await this.send("Extensions.loadUnpacked", { path: dir });
    this.id = id;
    this.origin = `chrome-extension://${id}`;
    this.workerUrl = `${this.origin}/background.js`;
    await this.#settleWorkers();
    return id;
  }

  // Pages never reach the real internet: every http(s) request that survives
  // the extension's redirects is answered with an empty 200, so the tests need
  // no network and only look at where navigation ended up. A request to the go
  // host that gets here was not redirected, and is failed to make that visible.
  #stubRequest(sessionId, { requestId, request }) {
    const host = new URL(request.url).hostname;
    const reply =
      host === "go"
        ? this.send("Fetch.failRequest", { requestId, errorReason: "ConnectionRefused" }, sessionId)
        : this.send(
            "Fetch.fulfillRequest",
            { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "text/html" }], body: "" },
            sessionId,
          );
    reply.catch(() => {});
  }

  async newPage() {
    const { targetId } = await this.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    await this.send("Fetch.enable", { patterns: [{ urlPattern: "http*://*" }] }, sessionId);
    return { targetId, sessionId, chrome: this };
  }

  /** Navigate a page target; resolves once Chrome has started the navigation. */
  async navigate(page, url) {
    await this.send("Page.navigate", { url: "about:blank" }, page.sessionId);
    await this.waitUrl(page, (u) => u === "about:blank");
    await this.send("Page.navigate", { url }, page.sessionId);
  }

  /** Poll the page's URL until predicate(url) holds; returns the last URL seen. */
  async waitUrl(page, predicate, timeout = 8000) {
    const deadline = Date.now() + timeout;
    let url = "";
    while (Date.now() < deadline) {
      url = await this.targetUrl(page.targetId);
      if (predicate(url)) return url;
      await sleep(100);
    }
    return url;
  }

  /** Evaluate an expression inside the page (awaiting promises) and return its value. */
  async evaluate(page, expression) {
    await this.send("Runtime.enable", {}, page.sessionId);
    const { result, exceptionDetails } = await this.send(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      page.sessionId,
    );
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }

  /** Give the page a viewport of exactly width x height CSS pixels. */
  async setViewport(page, width, height) {
    await this.send(
      "Emulation.setDeviceMetricsOverride",
      { width, height, deviceScaleFactor: 1, mobile: false },
      page.sessionId,
    );
  }

  /** PNG of the page's viewport, as a Buffer. */
  async screenshot(page) {
    const { data } = await this.send("Page.captureScreenshot", { format: "png" }, page.sessionId);
    return Buffer.from(data, "base64");
  }

  async targetUrl(targetId) {
    const { targetInfos } = await this.send("Target.getTargets");
    return targetInfos.find((t) => t.targetId === targetId)?.url ?? "";
  }

  workerLog() {
    return this.workerLogs.join("\n");
  }

  async waitWorkerLog(text, timeout = 20_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (this.workerLog().includes(text)) return true;
      await sleep(100);
    }
    return false;
  }

  async stop() {
    if (!this.proc) return;
    try {
      this.ws?.close();
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
}
