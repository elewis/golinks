// Appearance (Light | Dark | System), driven from the harness page (op=theme). The test profile's browser
// setting is dark (layout.css.prefers-color-scheme.content-override), so System is dark and Light must win.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startFirefox } from "./lib/fixture.mjs";

const LIGHT = "rgb(246, 247, 249)";
const DARK = "rgb(16, 20, 26)";

let fx;
before(async () => (fx = await startFirefox({ "layout.css.prefers-color-scheme.content-override": 0 })));
after(() => fx?.stop());

test("System follows the browser, Light and Dark win, the choice is stored and shared by other pages", async () => {
  await fx.ff.get("about:blank");
  await fx.ff.waitUrl((u) => u === "about:blank");
  await fx.ff.get("https://go/zztest-theme");
  const url = await fx.ff.waitFor(
    () => fx.ff.currentUrl(),
    (u) => u.includes("#result="),
    30_000,
  );
  assert.ok(url.includes("#result="), `harness gave no result, url=${url}`);
  const r = JSON.parse(Buffer.from(url.split("#result=")[1], "hex").toString());
  assert.ok(r.ok, `harness failed: ${r.error}`);
  assert.equal(r.theme, null, "no data-theme for System");
  assert.equal(r.pressedSystem, "system");
  assert.equal(r.system, DARK);
  assert.equal(r.light, LIGHT);
  assert.equal(r.storedLight, "light");
  assert.equal(r.popupLight, LIGHT);
  assert.equal(r.dark, DARK);
  assert.equal(r.systemAgain, DARK);
  assert.equal(r.invalid, DARK, "an invalid stored value is System");
});
