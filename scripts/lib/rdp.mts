// Minimal client for Firefox's Remote Debugging Protocol (the one web-ext and
// about:debugging use), on node:net only. A packet is `<byte length>:<json>`.
import net from "node:net";

/** A decoded packet. Firefox's protocol is open-ended, so the fields are loose. */
export interface Packet {
  from?: string;
  error?: string;
  message?: string;
  [key: string]: any;
}

interface Waiting {
  from: string;
  resolve: (packet: Packet) => void;
  reject: (error: Error) => void;
}

export function encodePacket(obj: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(obj), "utf8");
  return Buffer.concat([Buffer.from(`${json.length}:`), json]);
}

const NOT_RDP = "not the Firefox debugger protocol";

/** Splits a byte stream into packets; keeps any partial packet for the next push. */
export class PacketParser {
  #buf: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Packet[] {
    this.#buf = Buffer.concat([this.#buf, chunk]);
    const packets: Packet[] = [];
    for (;;) {
      const colon = this.#buf.indexOf(":");
      const head = this.#buf.subarray(0, colon === -1 ? Math.min(this.#buf.length, 12) : colon).toString("latin1");
      if (!/^\d*$/.test(head) || (colon === -1 && head.length >= 12) || (colon === 0)) {
        throw new Error(NOT_RDP);
      }
      if (colon === -1) return packets;
      const length = Number(head);
      const end = colon + 1 + length;
      if (this.#buf.length < end) return packets;
      const body = this.#buf.subarray(colon + 1, end).toString("utf8");
      this.#buf = this.#buf.subarray(end);
      try {
        packets.push(JSON.parse(body));
      } catch {
        throw new Error(NOT_RDP);
      }
    }
  }
}

export class RdpClient {
  #sock: net.Socket;
  #parser = new PacketParser();
  #waiting: Waiting | null = null;
  #inbox: Packet[] = [];
  #error: Error | null = null;

  constructor(sock: net.Socket) {
    this.#sock = sock;
    sock.on("data", (d: Buffer) => {
      try {
        for (const p of this.#parser.push(d)) this.#deliver(p);
      } catch (e) {
        this.#fail(e as Error);
      }
    });
    sock.on("error", (e) => this.#fail(e));
    sock.on("close", () => this.#fail(new Error("connection to Firefox closed")));
  }

  /** Connect and wait for the root actor's greeting. */
  static async connect(port: number, { host = "127.0.0.1", timeout = 5000 }: { host?: string; timeout?: number } = {}): Promise<RdpClient> {
    const sock = net.connect({ port, host });
    await new Promise<void>((resolve, reject) => {
      sock.once("connect", () => resolve());
      sock.once("error", reject);
    });
    const client = new RdpClient(sock);
    try {
      const hello = await client.#next("root", timeout, `port ${port} accepted the connection but did not answer like Firefox`);
      if (hello.applicationType === undefined) throw new Error(NOT_RDP);
    } catch (e) {
      client.close();
      throw e;
    }
    return client;
  }

  #deliver(packet: Packet): void {
    if (this.#waiting && packet.from === this.#waiting.from) {
      const { resolve, reject } = this.#waiting;
      this.#waiting = null;
      if (packet.error) reject(new Error(packet.message ? `${packet.error}: ${packet.message}` : packet.error));
      else resolve(packet);
    } else {
      this.#inbox.push(packet);
    }
  }

  #fail(e: Error): void {
    this.#error ??= e;
    if (this.#waiting) {
      const { reject } = this.#waiting;
      this.#waiting = null;
      reject(this.#error);
    }
  }

  #next(from: string, timeout: number, timeoutMessage?: string): Promise<Packet> {
    const queued = this.#inbox.findIndex((p) => p.from === from);
    if (queued !== -1) return Promise.resolve(this.#inbox.splice(queued, 1)[0]);
    if (this.#error) return Promise.reject(this.#error);
    return new Promise<Packet>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiting = null;
        reject(new Error(timeoutMessage ?? `Firefox did not answer within ${timeout} ms`));
      }, timeout);
      this.#waiting = {
        from,
        resolve: (p) => (clearTimeout(timer), resolve(p)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      };
    });
  }

  async request(to: string, type: string, params: Record<string, unknown> = {}, timeout = 30_000): Promise<Packet> {
    if (this.#error) throw this.#error;
    this.#sock.write(encodePacket({ to, type, ...params }));
    return this.#next(to, timeout);
  }

  /** Install (or, for an id already installed, replace and reload) a temporary add-on. */
  async installTemporaryAddon(addonPath: string): Promise<Packet> {
    const { addonsActor } = await this.request("root", "getRoot");
    if (!addonsActor) throw new Error("Firefox did not offer an add-ons actor");
    const reply = await this.request(addonsActor, "installTemporaryAddon", { addonPath, openDevTools: false });
    return reply.addon;
  }

  /** Ids of every add-on Firefox lists, with whether it is temporary. */
  async listAddons(): Promise<{ id: string; name: string; temporary: boolean }[]> {
    const { addons } = await this.request("root", "listAddons");
    return addons.map((a: Packet) => ({ id: a.id, name: a.name, temporary: a.temporarilyInstalled === true }));
  }

  /** Run JavaScript with chrome privileges in Firefox's parent process; resolves to the result's grip. */
  async evaluateChrome(text: string, timeout = 30_000): Promise<Packet> {
    const { processDescriptor } = await this.request("root", "getProcess", { id: 0 });
    const { process } = await this.request(processDescriptor.actor, "getTarget");
    const consoleActor = process.consoleActor;
    await this.request(consoleActor, "evaluateJSAsync", { text });
    const reply = await this.#next(consoleActor, timeout);
    if (reply.exception) {
      const error: Error & { scriptError?: boolean } = new Error(`Firefox could not run the script: ${reply.exceptionMessage ?? JSON.stringify(reply.exception.preview ?? reply.exception)}`);
      error.scriptError = true;
      throw error;
    }
    return reply.result;
  }

  /**
   * Close the debugger server's listening socket, so the window loses the
   * "remote controlled" look and no program can connect any more. Firefox drops
   * every connection with it, this one included, so this resolves once that
   * has happened. A temporary add-on installed through the server stays.
   */
  async closeServer(timeout = 10_000): Promise<void> {
    const dropped = new Promise<void>((resolve) => this.#sock.once("close", resolve));
    try {
      await this.evaluateChrome(CLOSE_SERVER_SCRIPT);
    } catch (e) {
      // The script ran and was refused: report it. Any other failure is Firefox
      // dropping the connection as the close takes effect, which is the success
      // case; the caller checks the port is really refused.
      if ((e as { scriptError?: boolean }).scriptError) {
        throw new Error(`${(e as Error).message} (the close relies on Firefox internals: DistinctSystemPrincipalLoader.sys.mjs and the devtools-startup-clh component, checked on Firefox 157)`);
      }
    }
    let timer: NodeJS.Timeout | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Firefox did not close its debugger server")), timeout);
    });
    try {
      await Promise.race([dropped, expired]);
    } finally {
      clearTimeout(timer); // else the pending timer keeps Node alive for the full timeout
    }
  }

  close(): void {
    this.#sock.destroy();
  }
}

// Firefox shows its "remote control" cue (striped URL bar, robot icon) for as
// long as a DevTools socket listens (browser.js, gRemoteControl). The server
// that `--start-debugger-server` starts lives in a private loader that
// DevToolsStartup owns, so ask for that same loader to reach the same server.
// The close runs on the next tick so this call can still return its result.
export const CLOSE_SERVER_SCRIPT = `(function () {
  const { useDistinctSystemPrincipalLoader, releaseDistinctSystemPrincipalLoader } = ChromeUtils.importESModule(
    "resource://devtools/shared/loader/DistinctSystemPrincipalLoader.sys.mjs", { global: "shared" });
  const startup = Cc["@mozilla.org/devtools/startup-clh;1"].getService().wrappedJSObject;
  const loader = useDistinctSystemPrincipalLoader(startup);
  try {
    const { DevToolsServer } = loader.require("resource://devtools/server/devtools-server.js");
    const listening = DevToolsServer.listeningSockets;
    if (!listening) throw new Error("no debugger server is listening in DevToolsStartup's loader");
    Services.tm.dispatchToMainThread(() => DevToolsServer.closeAllSocketListeners());
    return listening;
  } finally {
    releaseDistinctSystemPrincipalLoader(startup);
  }
})()`;
