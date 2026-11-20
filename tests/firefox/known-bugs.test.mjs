// Check 4: known bugs, kept as expected failures so they show up in every run.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startFirefox } from "./lib/fixture.mjs";

let fx;
before(async () => (fx = await startFirefox()));
after(() => fx?.stop());

describe("known bugs", () => {
  // Known bug: the webRequest listener redirects any URL containing "go/", so an
  // ordinary GitHub URL is hijacked to https://go/issues. Remove the `todo`
  // option when the bug is fixed. A `todo` test that passes is reported as
  // "# TODO" without failing the run, so shout when that happens.
  test(
    "https://github.com/golang/go/issues is not redirected",
    { todo: "known bug: webRequest redirects any URL containing go/" },
    async (t) => {
      await fx.ff.get("about:blank");
      await fx.ff.waitUrl((u) => u === "about:blank");
      await fx.ff.get("https://github.com/golang/go/issues");
      // A hijacked request ends on https://go/... or an extension page.
      const url = await fx.ff.waitUrl(
        (u) => u.startsWith("moz-extension://") || u.startsWith("https://go/"),
        4000,
      );
      const unchanged = !url.startsWith("moz-extension://") && !url.startsWith("https://go/");
      if (unchanged) {
        const msg = "UNEXPECTED PASS: the webRequest go/ redirect bug appears fixed; remove the `todo` option from known-bugs.test.mjs";
        t.diagnostic(msg);
        console.error(`\n!!! ${msg}\n`);
      }
      assert.ok(unchanged, `redirected to ${url}`);
    },
  );
});
