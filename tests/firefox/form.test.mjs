// The options form writes storage exactly once per add or delete, and always
// from the links currently in storage (not a stale render's snapshot).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startFirefox } from "./lib/fixture.mjs";

let fx;
before(async () => (fx = await startFirefox()));
after(() => fx?.stop());

test("each add and delete makes exactly one storage.set", async () => {
  await fx.ff.get("about:blank");
  await fx.ff.waitUrl((u) => u === "about:blank");
  await fx.ff.get("https://go/zztest-writes");
  const url = await fx.ff.waitFor(() => fx.ff.currentUrl(), (u) => u.includes("#result="), 20_000);
  assert.ok(url.includes("#result="), `harness gave no result, url=${url}`);
  const result = JSON.parse(Buffer.from(url.split("#result=")[1], "hex").toString());
  assert.ok(result.ok, `harness failed: ${result.error}`);
  assert.deepEqual(result.perAction, [1, 1, 1, 1]);
  assert.equal(result.keys, "zza,zzc");
});
