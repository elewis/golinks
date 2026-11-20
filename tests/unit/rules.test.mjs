import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMON, load } from "./lib/sandbox.mjs";

const sb = () => load(COMMON);

test("escapeRegex escapes every regex metacharacter", () => {
  const { get } = sb();
  assert.equal(get('escapeRegex("a.b")'), "a\\.b");
  assert.equal(get('escapeRegex("c++")'), "c\\+\\+");
  assert.equal(get('escapeRegex(".*+?^${}()|[]\\\\")'), "\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\");
  assert.equal(get('escapeRegex("plain-name_1")'), "plain-name_1");
});

test("get_rule: a static link is a urlFilter redirect to the destination", () => {
  const rule = sb().get('get_rule("gh", "https://github.com")');
  assert.deepEqual(JSON.parse(JSON.stringify(rule)), {
    priority: 5,
    action: { type: "redirect", redirect: { url: "https://github.com" } },
    condition: { urlFilter: "||go/gh|", resourceTypes: ["main_frame"] },
  });
});

test("get_rule: a %s link is a regex redirect substituting capture group 1", () => {
  const rule = sb().get('get_rule("cs", "https://github.com/search?q=%s")');
  assert.equal(rule.action.redirect.regexSubstitution, "https://github.com/search?q=\\1");
  assert.equal(rule.condition.regexFilter, "^https?://go/cs(?:/([^/]*))?");
  assert.equal(rule.condition.urlFilter, undefined);
});

test("get_rule: the regexFilter matches the name literally and captures the argument", () => {
  const { get } = sb();
  const re = new RegExp(get('get_rule("a.b", "https://x/%s")').condition.regexFilter);
  assert.equal(re.exec("https://go/a.b/query")[1], "query");
  assert.equal(re.test("https://go/axb/query"), false);
  const plus = new RegExp(get('get_rule("c++", "https://x/%s")').condition.regexFilter);
  assert.equal(plus.exec("http://go/c++/z")[1], "z");
  assert.equal(plus.test("https://go/cc/z"), false);
});

test("updateRulesWithLinks: link rules, then help, root and not-found, ids 1..N", async () => {
  const { fake, get } = sb();
  await get('updateRulesWithLinks({ gh: "https://github.com", cs: "https://s/%s" })');
  const rules = fake.rules();
  assert.deepEqual(rules.map((r) => r.id), [1, 2, 3, 4, 5]);
  assert.deepEqual(rules.map((r) => r.priority), [5, 5, 2, 2, 1]);
  assert.deepEqual(rules.slice(2).map((r) => r.condition.urlFilter), ["||go/help|", "||go/|", "||go/*"]);
  assert.equal(rules[2].action.redirect.extensionPath, "/index.html");
  assert.equal(rules[4].action.redirect.extensionPath, "/notfound.html");
});

test("updateRulesWithLinks removes the previous rules", async () => {
  const { fake, get } = sb();
  await get('updateRulesWithLinks({ a: "https://a" })');
  await get('updateRulesWithLinks({ b: "https://b", c: "https://c" })');
  assert.deepEqual(fake.calls[1].removeRuleIds, [1, 2, 3, 4]);
  assert.equal(fake.rules().length, 5);
  assert.equal(fake.rules()[0].condition.urlFilter, "||go/b|");
});

test("getLinks: defaults, with localLinks overriding them; defaults are stored", async () => {
  const { fake, get } = sb();
  fake.store.sync.localLinks = { gh: "https://mine", extra: "https://e" };
  const links = await get("getLinks()");
  assert.equal(links.gh, "https://mine");
  assert.equal(links.extra, "https://e");
  assert.equal(links.github, "https://github.com");
  assert.ok(fake.store.sync.defaultLinks.cs);
});

test("refreshRules: overlapping calls never interleave and end on the latest links", async () => {
  const { fake, get } = sb();
  // Hold every dynamic-rule write so that interleaving would be visible.
  let active = 0, maxActive = 0;
  const real = fake.api.declarativeNetRequest.updateDynamicRules;
  fake.api.declarativeNetRequest.updateDynamicRules = async (a) => {
    active++; maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 5));
    try { return await real(a); } finally { active--; }
  };
  const runs = [];
  for (let i = 0; i < 8; i++) {
    fake.store.sync.localLinks = { last: `https://v${i}` };
    runs.push(get("refreshRules()"));
  }
  await Promise.all(runs); // would reject with "Duplicate rule ID" without the queue
  assert.equal(maxActive, 1);
  const names = fake.rules().map((r) => r.condition.urlFilter);
  assert.ok(names.includes("||go/last|"));
  assert.equal(fake.rules().find((r) => r.condition.urlFilter === "||go/last|").action.redirect.url, "https://v7");
});

test("refreshRules: a failed update does not block the next one", async () => {
  const { fake, get, logs } = sb();
  const real = fake.api.declarativeNetRequest.updateDynamicRules;
  fake.api.declarativeNetRequest.updateDynamicRules = async () => { throw new Error("boom"); };
  await assert.rejects(get("refreshRules()"), /boom/);
  fake.api.declarativeNetRequest.updateDynamicRules = real;
  await get("refreshRules()");
  assert.ok(fake.rules().length > 0);
  assert.ok(logs.some(([l]) => l === "error"));
});

test("the storage listener refreshes rules only for sync changes to the link keys", async () => {
  const { fake } = sb();
  const [listener] = fake.listeners.storageChanged;
  await listener({ localLinks: {} }, "local");
  await listener({ other: {} }, "sync");
  assert.equal(fake.calls.length, 0);
  await listener({ localLinks: {} }, "sync");
  assert.equal(fake.calls.length, 1);
  await listener({ defaultLinks: {} }, "sync");
  assert.equal(fake.calls.length, 2);
});
