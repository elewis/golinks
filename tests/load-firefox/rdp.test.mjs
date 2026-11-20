import assert from "node:assert/strict";
import net from "node:net";
import { test } from "node:test";
import { PacketParser, RdpClient, encodePacket } from "../../scripts/lib/rdp.mjs";

test("encodePacket prefixes the byte length, not the character count", () => {
  assert.equal(encodePacket({ a: "é" }).toString(), '10:{"a":"é"}');
  assert.equal(encodePacket({ to: "root" }).toString(), '13:{"to":"root"}');
});

test("PacketParser returns whole packets and keeps partial ones", () => {
  const p = new PacketParser();
  const bytes = Buffer.concat([encodePacket({ n: 1 }), encodePacket({ n: 2 })]);
  assert.deepEqual(p.push(bytes.subarray(0, 3)), []);
  assert.deepEqual(p.push(bytes.subarray(3, 14)), [{ n: 1 }]);
  assert.deepEqual(p.push(bytes.subarray(14)), [{ n: 2 }]);
});

test("PacketParser handles a multibyte character split across chunks", () => {
  const p = new PacketParser();
  const bytes = encodePacket({ s: "日本" });
  const out = [...p.push(bytes.subarray(0, 8)), ...p.push(bytes.subarray(8))];
  assert.deepEqual(out, [{ s: "日本" }]);
});

test("PacketParser rejects data that is not the debugger protocol", () => {
  assert.throws(() => new PacketParser().push(Buffer.from("HTTP/1.1 400 Bad Request\r\n")), /not the Firefox debugger protocol/);
});

/** A fake debugger server: replies to each request with reply(request). */
function fakeServer(reply, hello = { from: "root", applicationType: "browser" }) {
  const server = net.createServer((sock) => {
    const parser = new PacketParser();
    sock.write(encodePacket(hello));
    sock.on("data", (d) => {
      for (const req of parser.push(d)) sock.write(encodePacket({ from: req.to, ...reply(req) }));
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })),
  );
}

test("installTemporaryAddon asks the addons actor to install the path", async () => {
  const seen = [];
  const { server, port } = await fakeServer((req) => {
    seen.push(req);
    if (req.type === "getRoot") return { addonsActor: "addons1" };
    return { addon: { id: "x@y", actor: false } };
  });
  try {
    const client = await RdpClient.connect(port);
    const addon = await client.installTemporaryAddon("/some/dir");
    client.close();
    assert.equal(addon.id, "x@y");
    assert.deepEqual(seen[1], { to: "addons1", type: "installTemporaryAddon", addonPath: "/some/dir", openDevTools: false });
  } finally {
    server.close();
  }
});

test("a protocol error reply becomes a thrown error with Firefox's message", async () => {
  const { server, port } = await fakeServer((req) =>
    req.type === "getRoot" ? { addonsActor: "a" } : { error: "unknownError", message: "Could not install add-on: bad manifest" },
  );
  try {
    const client = await RdpClient.connect(port);
    await assert.rejects(client.installTemporaryAddon("/x"), /Could not install add-on: bad manifest/);
    client.close();
  } finally {
    server.close();
  }
});

test("connect rejects when nothing listens on the port", async () => {
  const { server, port } = await fakeServer(() => ({}));
  await new Promise((r) => server.close(r));
  await assert.rejects(RdpClient.connect(port), (e) => e.code === "ECONNREFUSED");
});

test("connect rejects when the port speaks another protocol", async () => {
  const server = net.createServer((s) => s.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    await assert.rejects(RdpClient.connect(server.address().port), /not the Firefox debugger protocol/);
  } finally {
    server.close();
  }
});

test("connect rejects when the server stays silent", async () => {
  const server = net.createServer(() => {});
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    await assert.rejects(RdpClient.connect(server.address().port, { timeout: 200 }), /did not answer/);
  } finally {
    server.close();
  }
});
