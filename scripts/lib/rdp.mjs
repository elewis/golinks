// Minimal client for Firefox's Remote Debugging Protocol (the one web-ext and
// about:debugging use), on node:net only. A packet is `<byte length>:<json>`.
import net from "node:net";

export function encodePacket(obj) {
  const json = Buffer.from(JSON.stringify(obj), "utf8");
  return Buffer.concat([Buffer.from(`${json.length}:`), json]);
}

const NOT_RDP = "not the Firefox debugger protocol";

/** Splits a byte stream into packets; keeps any partial packet for the next push. */
export class PacketParser {
  #buf = Buffer.alloc(0);

  push(chunk) {
    this.#buf = Buffer.concat([this.#buf, chunk]);
    const packets = [];
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
  #sock;
  #parser = new PacketParser();
  #waiting = null; // { from, resolve, reject }
  #inbox = [];
  #error = null;

  constructor(sock) {
    this.#sock = sock;
    sock.on("data", (d) => {
      try {
        for (const p of this.#parser.push(d)) this.#deliver(p);
      } catch (e) {
        this.#fail(e);
      }
    });
    sock.on("error", (e) => this.#fail(e));
    sock.on("close", () => this.#fail(new Error("connection to Firefox closed")));
  }

  /** Connect and wait for the root actor's greeting. */
  static async connect(port, { host = "127.0.0.1", timeout = 5000 } = {}) {
    const sock = net.connect({ port, host });
    await new Promise((resolve, reject) => {
      sock.once("connect", resolve);
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

  #deliver(packet) {
    if (this.#waiting && packet.from === this.#waiting.from) {
      const { resolve, reject } = this.#waiting;
      this.#waiting = null;
      if (packet.error) reject(new Error(packet.message ? `${packet.error}: ${packet.message}` : packet.error));
      else resolve(packet);
    } else {
      this.#inbox.push(packet);
    }
  }

  #fail(e) {
    this.#error ??= e;
    if (this.#waiting) {
      const { reject } = this.#waiting;
      this.#waiting = null;
      reject(this.#error);
    }
  }

  #next(from, timeout, timeoutMessage) {
    const queued = this.#inbox.findIndex((p) => p.from === from);
    if (queued !== -1) return Promise.resolve(this.#inbox.splice(queued, 1)[0]);
    if (this.#error) return Promise.reject(this.#error);
    return new Promise((resolve, reject) => {
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

  async request(to, type, params = {}, timeout = 30_000) {
    if (this.#error) throw this.#error;
    this.#sock.write(encodePacket({ to, type, ...params }));
    return this.#next(to, timeout);
  }

  /** Install (or, for an id already installed, replace and reload) a temporary add-on. */
  async installTemporaryAddon(addonPath) {
    const { addonsActor } = await this.request("root", "getRoot");
    if (!addonsActor) throw new Error("Firefox did not offer an add-ons actor");
    const reply = await this.request(addonsActor, "installTemporaryAddon", { addonPath, openDevTools: false });
    return reply.addon;
  }

  /** Ids of every add-on Firefox lists, with whether it is temporary. */
  async listAddons() {
    const { addons } = await this.request("root", "listAddons");
    return addons.map((a) => ({ id: a.id, name: a.name, temporary: a.temporarilyInstalled === true }));
  }

  close() {
    this.#sock.destroy();
  }
}
