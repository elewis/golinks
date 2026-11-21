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
      `[...document.querySelectorAll("#user-links tr")]
         .find((r) => r.firstChild.textContent === "go/${NAME}")
         .querySelector("button").click(); true`,
    );
    await until(async () => !(await hasRule()), "rule removal");
    const url = await finalUrl(`https://go/${NAME}`, isNotFound);
    assert.ok(isNotFound(url), `go/${NAME} -> ${url}`);
  });
});
