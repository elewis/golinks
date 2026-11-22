// Check 3: links added and deleted through the options form (index.html)
// change the redirect rules. The form is driven with Runtime.evaluate in an
// extension page opened as a normal tab.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startChrome } from "./lib/fixture.mjs";

let fx, page, form;
before(async () => {
  fx = await startChrome();
  page = await fx.chrome.newPage();
  form = await fx.chrome.newPage();
});
after(() => fx?.stop());

const NAME = "zzmine";
const URL_ = "https://example.com/mine";

async function openOptions() {
  await fx.chrome.navigate(form, `${fx.chrome.origin}/index.html`);
  await fx.chrome.waitUrl(form, (u) => u.endsWith("/index.html"));
  const ready = `!!document.getElementById("add-btn")`;
  for (let i = 0; i < 80 && !(await fx.chrome.evaluate(form, ready)); i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function finalUrl(url, predicate) {
  await fx.chrome.navigate(page, url);
  return fx.chrome.waitUrl(page, predicate);
}

const isNotFound = (u) => u.startsWith(`${fx.chrome.origin}/notfound.html?name=`);
const hasRule = () =>
  fx.chrome.evaluate(
    form,
    `chrome.declarativeNetRequest.getDynamicRules().then((rs) => rs.some((r) => JSON.stringify(r.condition).includes("go/${NAME}")))`,
  );

async function until(fn, what) {
  for (let i = 0; i < 80; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(`timed out waiting for ${what}`);
}

describe("link storage changes update the rules", () => {
  test("link does not exist before it is added", async () => {
    const url = await finalUrl(`https://go/${NAME}`, isNotFound);
    assert.ok(isNotFound(url), `go/${NAME} -> ${url}`);
  });

  test("a link added through the options form redirects", async () => {
    await openOptions();
    await fx.chrome.evaluate(
      form,
      `document.getElementById("link-name").value = ${JSON.stringify(NAME)};
       document.getElementById("link-url").value = ${JSON.stringify(URL_)};
       document.getElementById("add-btn").click(); true`,
    );
    await until(hasRule, "rule for the new link");
    const url = await finalUrl(`https://go/${NAME}`, (u) => u.startsWith("https://example.com/"));
    assert.equal(url, URL_);
  });

  test("a link deleted through the options form stops redirecting", async () => {
    await openOptions();
    await fx.chrome.evaluate(
      form,
      `[...document.querySelectorAll("#links tr")]
         .find((r) => r.firstChild.textContent === "go/${NAME}")
         .querySelector("button").click(); true`,
    );
    await until(async () => !(await hasRule()), "rule removal");
    const url = await finalUrl(`https://go/${NAME}`, isNotFound);
    assert.ok(isNotFound(url), `go/${NAME} -> ${url}`);
  });
});

describe("default links are ordinary links", () => {
  test("go/help has Get Started, one Links table and Settings; deleting go/gg removes its redirect", async () => {
    await openOptions();
    const titles = await fx.chrome.evaluate(
      form,
      `[...document.querySelectorAll("h2.section-title")].map((h) => h.textContent)`,
    );
    assert.deepEqual(titles, ["Get Started", "Links", "Settings"]);
    assert.equal(await fx.chrome.evaluate(form, `document.getElementById("default-links") === null`), true);
    await until(
      () =>
        fx.chrome.evaluate(
          form,
          `[...document.querySelectorAll("#links tr")].some((r) => r.firstChild.textContent === "go/gg")`,
        ),
      "the go/gg row",
    );
    await fx.chrome.evaluate(
      form,
      `[...document.querySelectorAll("#links tr")].find((r) => r.firstChild.textContent === "go/gg").querySelector("button").click(); true`,
    );
    await until(
      async () =>
        !(await fx.chrome.evaluate(
          form,
          `chrome.declarativeNetRequest.getDynamicRules().then((rs) => rs.some((r) => JSON.stringify(r.condition).includes("go/gg")))`,
        )),
      "rule removal",
    );
    const url = await finalUrl("https://go/gg", isNotFound);
    assert.ok(isNotFound(url), `go/gg -> ${url}`);
  });
});

describe("a legacy localLinks item is migrated", () => {
  test("its links become link:<name> items with working redirects, and the item is removed", async () => {
    await openOptions();
    // What an old version stored. The next links refresh (any link:* change, or a start) migrates it.
    await fx.chrome.evaluate(
      form,
      `chrome.storage.sync.set({ localLinks: { ZZLegacy: "https://example.com/legacy" } })
         .then(() => chrome.storage.sync.set({ "link:zztrigger": "https://example.com/trigger" })).then(() => true)`,
    );
    await until(
      () =>
        fx.chrome.evaluate(
          form,
          `chrome.storage.sync.get(null).then((a) => !("localLinks" in a) && a["link:zzlegacy"])`,
        ),
      "the migration",
    );
    const url = await finalUrl("https://go/zzlegacy", (u) => u.startsWith("https://example.com/"));
    assert.equal(url, "https://example.com/legacy");
  });
});
