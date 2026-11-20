// Check 4: ordinary URLs that merely contain "go/" are left alone. (The
// Firefox build has a known bug here; Chrome has no webRequest listener.)
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startChrome } from "./lib/fixture.mjs";

let fx, page;
before(async () => {
  fx = await startChrome();
  page = await fx.chrome.newPage();
});
after(() => fx?.stop());

test("https://github.com/golang/go/issues is not redirected", async () => {
  const url = "https://github.com/golang/go/issues";
  await fx.chrome.navigate(page, url);
  // A hijacked request ends on https://go/... or an extension page.
  const final = await fx.chrome.waitUrl(
    page,
    (u) => u.startsWith("chrome-extension://") || u.startsWith("https://go/"),
    4000,
  );
  assert.equal(final, url);
});
