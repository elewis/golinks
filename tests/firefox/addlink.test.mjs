// The shared add-link form on the not-found page, popup page and go/help.
// The page is driven from the harness (WebDriver cannot script moz-extension
// pages). Not covered: the real toolbar click, Alt+Shift+G and the active-tab
// prefill of the popup (no way to press them or have an active tab for it).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startFirefox } from "./lib/fixture.mjs";

let fx;
before(async () => (fx = await startFirefox()));
after(() => fx?.stop());

async function navigate(url) {
  await fx.ff.get("about:blank");
  await fx.ff.waitUrl((u) => u === "about:blank");
  await fx.ff.get(url);
}

test("not-found page carries the name; the shared form saves, validates, lists and confirms overwrites", async () => {
  await navigate("https://go/zznew");
  const nfUrl = await fx.ff.waitUrl((u) => u.startsWith("moz-extension://"));
  assert.ok(nfUrl.endsWith("/notfound.html?name=zznew"), nfUrl);

  await navigate("https://go/zztest-addlink");
  const url = await fx.ff.waitFor(
    () => fx.ff.currentUrl(),
    (u) => u.includes("#result="),
    20_000,
  );
  assert.ok(url.includes("#result="), `harness gave no result, url=${url}`);
  const r = JSON.parse(Buffer.from(url.split("#result=")[1], "hex").toString());
  assert.ok(r.ok, `harness failed: ${r.error}`);
  assert.deepEqual([r.nfName, r.nfUrl, r.nfFocus], ["zznew", "", "link-url"]);
  assert.deepEqual(r.nfAfterSave, ["", "", "link-name"], "boxes emptied after a save, focus on the name");
  assert.deepEqual([r.popName, r.popFocus], ["", "link-url"]);
  assert.equal(r.validationWrote, false);
  assert.deepEqual(r.valKept, ["help", "https://x.test"], "a validation error keeps what was typed");
  assert.deepEqual(r.existing, ["go/gh", "go/github"]);
  assert.equal(r.confirmLabel, "Overwrite go/gh (now -> https://github.com)");
  assert.equal(r.wroteBeforeConfirm, false);
  assert.deepEqual(r.popSaved, {
    text: "Saved go/gh -> https://example.com/mine",
    cls: "msg-success",
    disabled: [true, true, true],
    values: ["gh", "https://example.com/mine"],
    closedEarly: 0,
  });
  assert.equal(r.popClosed, 1, "the popup closes itself once, after the delay");
  assert.equal(r.helpForms, 1);
  assert.equal(r.helpAligned, true, "go/help: name and URL boxes line up with the Link and Destination columns");
  assert.equal(r.helpAlignedLong, true, "go/help: still lined up with a very long destination");
  assert.match(r.helpConfirmLabel, /^Overwrite go\/gh \(now -> /);
  assert.equal(r.helpWroteBeforeConfirm, false);
  assert.equal(r.helpStatus, "Saved go/gh");
  assert.deepEqual(r.helpAfterSave, ["", "", "Add"], "go/help: boxes emptied after a confirmed overwrite");

  await navigate("https://go/zznew");
  assert.equal(await fx.ff.waitUrl((u) => u.startsWith("https://example.com/")), "https://example.com/new");
  await navigate("https://go/gh");
  assert.equal(await fx.ff.waitUrl((u) => u.startsWith("https://example.com/")), "https://example.com/fromhelp");
});
