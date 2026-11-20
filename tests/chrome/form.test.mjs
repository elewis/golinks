// The options form writes storage exactly once per add or delete, and always
// from the links currently in storage (not a stale render's snapshot).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startChrome } from "./lib/fixture.mjs";

let fx, form;
before(async () => {
  fx = await startChrome();
  form = await fx.chrome.newPage();
  await fx.chrome.navigate(form, `${fx.chrome.origin}/index.html`);
  await fx.chrome.waitUrl(form, (u) => u.endsWith("/index.html"));
  await until(() => fx.chrome.evaluate(form, `!!document.getElementById("add-btn")`));
  // Count every storage.sync.set made by the page.
  await fx.chrome.evaluate(
    form,
    `window.__sets = [];
     const orig = chrome.storage.sync.set.bind(chrome.storage.sync);
     chrome.storage.sync.set = (v) => { window.__sets.push(v); return orig(v); }; true`,
  );
});
after(() => fx?.stop());

async function until(fn) {
  for (let i = 0; i < 80; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail("timed out");
}

const sets = () => fx.chrome.evaluate(form, `window.__sets.length`);
const stored = () =>
  fx.chrome.evaluate(
    form,
    `chrome.storage.sync.get("localLinks").then((r) => Object.keys(r.localLinks || {}).sort().join(","))`,
  );

async function add(name, url) {
  const before = await sets();
  await fx.chrome.evaluate(
    form,
    `document.getElementById("link-name").value = ${JSON.stringify(name)};
     document.getElementById("link-url").value = ${JSON.stringify(url)};
     document.getElementById("add-btn").click(); true`,
  );
  await until(async () => (await sets()) > before);
  await new Promise((r) => setTimeout(r, 300)); // let any extra handlers fire
}

describe("options form storage writes", () => {
  test("each add makes exactly one storage.set", async () => {
    for (const n of ["zza", "zzb", "zzc"]) {
      const before = await sets();
      await add(n, `https://example.com/${n}`);
      assert.equal((await sets()) - before, 1, `add ${n}`);
    }
    assert.equal(await stored(), "zza,zzb,zzc");
  });

  test("a delete makes exactly one storage.set and removes only that link", async () => {
    const before = await sets();
    await fx.chrome.evaluate(
      form,
      `[...document.querySelectorAll("#user-links tr")]
         .find((r) => r.firstChild.textContent === "go/zzb")
         .querySelector("button").click(); true`,
    );
    await until(async () => (await sets()) > before);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await sets()) - before, 1);
    assert.equal(await stored(), "zza,zzc");
  });
});
