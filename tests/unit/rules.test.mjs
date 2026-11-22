import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMON, linksIn, load, putLinks } from "./lib/sandbox.mjs";

const sb = () => load(COMMON);

test("escapeRegex escapes every regex metacharacter", () => {
  const { get } = sb();
  assert.equal(get('escapeRegex("a.b")'), "a\\.b");
  assert.equal(get('escapeRegex("c++")'), "c\\+\\+");
  assert.equal(get('escapeRegex(".*+?^${}()|[]\\\\")'), "\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\");
  assert.equal(get('escapeRegex("plain-name_1")'), "plain-name_1");
});

test("get_rule: a static link is an end-anchored regex redirect to the destination", () => {
  const rule = sb().get('get_rule("gh", "https://github.com")');
  assert.deepEqual(JSON.parse(JSON.stringify(rule)), {
    priority: 5,
    action: { type: "redirect", redirect: { url: "https://github.com" } },
    condition: { regexFilter: "^https?://go/gh$", isUrlFilterCaseSensitive: false, resourceTypes: ["main_frame"] },
  });
});

test("get_rule: a %s link is a regex redirect substituting capture group 1", () => {
  const rule = sb().get('get_rule("cs", "https://github.com/search?q=%s")');
  assert.equal(rule.action.redirect.regexSubstitution, "https://github.com/search?q=\\1");
  assert.equal(rule.condition.regexFilter, "^https?://go/cs(?:/(.*))?$");
  assert.equal(rule.condition.urlFilter, undefined);
});

const paramRe = (name) =>
  new RegExp(sb().get(`get_rule(${JSON.stringify(name)}, "https://x/%s")`).condition.regexFilter);
const staticRe = (name) => new RegExp(sb().get(`get_rule(${JSON.stringify(name)}, "https://x")`).condition.regexFilter);

test("%s link: go/csx does not match the cs rule", () => {
  const re = paramRe("cs");
  assert.equal(re.test("https://go/csx"), false);
  assert.equal(re.test("https://go/csx/query"), false);
  assert.equal(re.test("https://go/cs-more/q"), false);
});

test("%s link: the parameter is everything after go/<name>/", () => {
  const re = paramRe("cs");
  assert.equal(re.exec("https://go/cs/a/b")[1], "a/b");
  assert.equal(re.exec("http://go/cs/query")[1], "query");
  assert.equal(re.exec("https://go/cs/")[1], "");
});

test("%s link: bare go/cs still matches, with an empty parameter", () => {
  const m = paramRe("cs").exec("https://go/cs");
  assert.ok(m);
  assert.equal(m[1], undefined);
});

test("static link: matches only the exact name", () => {
  const re = staticRe("gh");
  assert.equal(re.test("https://go/gh"), true);
  assert.equal(re.test("http://go/gh"), true);
  assert.equal(re.test("https://go/ghx"), false);
  assert.equal(re.test("https://go/gh/extra"), false);
  assert.equal(re.test("https://go/g"), false);
});

test("static link: * ^ | in a name match literally, not as urlFilter wildcards", () => {
  const star = staticRe("a*b");
  assert.equal(star.test("https://go/a*b"), true);
  assert.equal(star.test("https://go/axxb"), false);
  const bar = staticRe("a|b");
  assert.equal(bar.test("https://go/a|b"), true);
  assert.equal(bar.test("https://go/a"), false);
  assert.equal(bar.test("https://go/b"), false);
  const caret = staticRe("a^b");
  assert.equal(caret.test("https://go/a^b"), true);
  assert.equal(caret.test("https://go/a/b"), false);
});

test("get_rule: the regexFilter matches the name literally and captures the argument", () => {
  const re = paramRe("a.b");
  assert.equal(re.exec("https://go/a.b/query")[1], "query");
  assert.equal(re.test("https://go/axb/query"), false);
  const plus = paramRe("c++");
  assert.equal(plus.exec("http://go/c++/z")[1], "z");
  assert.equal(plus.test("https://go/cc/z"), false);
  assert.equal(staticRe("a.b").test("https://go/axb"), false);
  assert.equal(staticRe("c++").test("https://go/c++"), true);
});

test("updateRulesWithLinks: link rules, then help, root and not-found, ids 1..N", async () => {
  const { fake, get } = sb();
  await get('updateRulesWithLinks({ gh: "https://github.com", cs: "https://s/%s" })');
  const rules = fake.rules();
  assert.deepEqual(
    rules.map((r) => r.id),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    rules.map((r) => r.priority),
    [5, 5, 2, 2, 1],
  );
  assert.deepEqual(
    rules.slice(2, 4).map((r) => r.condition.urlFilter),
    ["||go/help|", "||go/|"],
  );
  assert.equal(rules[2].action.redirect.extensionPath, "/index.html");
  assert.equal(rules[4].condition.regexFilter, "^https?://go/([^/?#]*)(?:[/?#].*)?$");
  assert.equal(rules[4].action.redirect.regexSubstitution, "chrome-extension://fake-id/notfound.html?name=\\1");
});

test("not-found rule: go/<name> reaches notfound.html?name=<name>; go/csx is not the cs rule", () => {
  const { fake, get } = sb();
  return get('updateRulesWithLinks({ cs: "https://s/%s" })').then(() => {
    const nf = fake.rules().at(-1);
    const re = new RegExp(nf.condition.regexFilter);
    const to = (u) => u.replace(re, nf.action.redirect.regexSubstitution.replace("\\1", "$1"));
    assert.equal(to("https://go/foo"), "chrome-extension://fake-id/notfound.html?name=foo");
    assert.equal(to("http://go/csx"), "chrome-extension://fake-id/notfound.html?name=csx");
    assert.equal(to("https://go/foo?x=1#y"), "chrome-extension://fake-id/notfound.html?name=foo");
    assert.equal(to("https://go/a/b"), "chrome-extension://fake-id/notfound.html?name=a");
    const cs = new RegExp(fake.rules()[0].condition.regexFilter);
    assert.equal(cs.test("https://go/csx"), false);
    assert.equal(nf.priority, 1);
    assert.equal(re.test("https://github.com/go/x"), false);
  });
});

test("updateRulesWithLinks removes the previous rules", async () => {
  const { fake, get } = sb();
  await get('updateRulesWithLinks({ a: "https://a" })');
  await get('updateRulesWithLinks({ b: "https://b", c: "https://c" })');
  assert.deepEqual(fake.calls[1].removeRuleIds, [1, 2, 3, 4]);
  assert.equal(fake.rules().length, 5);
  assert.equal(fake.rules()[0].condition.regexFilter, "^https?://go/b$");
});

const countSets = (fake) => {
  const sets = [];
  const set = fake.api.storage.sync.set;
  fake.api.storage.sync.set = (v) => (sets.push(v), set(v));
  return sets;
};

const SHIPPED = ["github", "gh", "cs", "gg", "yt", "mail", "gmail", "gcal"];
const sorted = (o) => Object.keys(o).sort();
const seededNames = (fake) =>
  Object.keys(fake.store.sync)
    .filter((k) => k.startsWith("seeded:"))
    .map((k) => k.slice(7))
    .sort();

test("seeding: a fresh install gets every shipped default as its own link:<name> item, in one write", async () => {
  const { fake, get } = sb();
  const sets = countSets(fake);
  const links = JSON.parse(JSON.stringify(await get("getLinks()")));
  assert.deepEqual(sorted(links), [...SHIPPED].sort());
  assert.equal(links.cs, "https://github.com/search?q=%s");
  assert.deepEqual(sorted(linksIn(fake)), [...SHIPPED].sort());
  assert.deepEqual(seededNames(fake), [...SHIPPED].sort());
  assert.equal(fake.store.sync["link:gh"], "https://github.com");
  assert.equal("localLinks" in fake.store.sync || "defaultLinks" in fake.store.sync, false);
  assert.equal(sets.length, 1);
});

test("seeding: idempotent, a second run writes nothing", async () => {
  const { fake, get } = sb();
  await get("getLinks()");
  const sets = countSets(fake);
  await get("getLinks()");
  await get("seedDefaults()");
  assert.deepEqual(sets, []);
});

test("seeding: a deleted default stays deleted (its seeded: key stays)", async () => {
  const { fake, get } = sb();
  await get("getLinks()");
  delete fake.store.sync["link:gh"];
  const links = JSON.parse(JSON.stringify(await get("getLinks()")));
  assert.equal("gh" in links, false);
  assert.equal("link:gh" in fake.store.sync, false);
  assert.equal(fake.store.sync["seeded:gh"], true);
});

test("seeding: only the defaults' own keys are written, other items are never touched", async () => {
  const { fake, get } = sb();
  fake.store.sync["link:mine"] = "https://m";
  const sets = countSets(fake);
  await get("getLinks()");
  assert.equal(sets.length, 1);
  assert.deepEqual(sorted(sets[0]), [...SHIPPED.flatMap((n) => [`link:${n}`, `seeded:${n}`])].sort());
  assert.equal(fake.store.sync["link:mine"], "https://m");
});

test("seeding: the user's link of the same name wins, and the default is marked seeded", async () => {
  const { fake, get } = sb();
  putLinks(fake, { gh: "https://mine", extra: "https://e" });
  const links = JSON.parse(JSON.stringify(await get("getLinks()")));
  assert.equal(links.gh, "https://mine");
  assert.equal(links.extra, "https://e");
  assert.equal(links.github, "https://github.com");
  assert.equal(fake.store.sync["seeded:gh"], true);
});

test("seeding: partly seeded, only the defaults without a seeded: key are added", async () => {
  const { fake, get } = sb();
  fake.store.sync["seeded:github"] = true; // seeded earlier and deleted by the user
  await get("getLinks()");
  assert.equal("link:github" in fake.store.sync, false);
  assert.equal(fake.store.sync["link:gg"], "https://google.com");
});

test("seeding: a default shipped in a later version is added once", async () => {
  const { fake, get } = sb();
  await get("getLinks()");
  delete fake.store.sync["seeded:gcal"]; // as if gcal were new in this version
  delete fake.store.sync["link:gcal"];
  await get("getLinks()");
  assert.equal(fake.store.sync["link:gcal"], "https://calendar.google.com");
  delete fake.store.sync["link:gcal"]; // the user deletes it again
  await get("getLinks()");
  assert.equal("link:gcal" in fake.store.sync, false);
});

test("seeding: concurrent calls seed once", async () => {
  const { fake, get } = sb();
  const sets = countSets(fake);
  await Promise.all([get("getLinks()"), get("getLinks()"), get("seedDefaults()"), get("getLinks()")]);
  assert.equal(sets.length, 1);
  assert.equal(sorted(linksIn(fake)).length, SHIPPED.length);
});

test("seeding: a failed write does not block the next seed", async () => {
  const { fake, get } = sb();
  const set = fake.api.storage.sync.set;
  fake.api.storage.sync.set = async () => {
    throw new Error("boom");
  };
  await assert.rejects(get("seedDefaults()"), /boom/);
  fake.api.storage.sync.set = set;
  await get("seedDefaults()");
  assert.equal(sorted(linksIn(fake)).length, SHIPPED.length);
});

test("migration: a legacy localLinks item becomes link:<name> items and is removed with defaultLinks", async () => {
  const { fake, get } = sb();
  fake.store.sync.localLinks = { docs: "https://d", gh: "https://mine" };
  fake.store.sync.defaultLinks = { github: "https://github.com" }; // the old record
  await get("getLinks()");
  assert.equal("localLinks" in fake.store.sync, false);
  assert.equal("defaultLinks" in fake.store.sync, false);
  assert.equal(fake.store.sync["link:docs"], "https://d");
  assert.equal(fake.store.sync["link:gh"], "https://mine"); // the user's link wins over the default
  // The old record does not count as seeded: the other defaults are seeded once.
  assert.equal(fake.store.sync["link:github"], "https://github.com");
  assert.deepEqual(seededNames(fake), [...SHIPPED].sort());
});

test("migration: an existing link:<name> item wins over the legacy entry", async () => {
  const { fake, get } = sb();
  fake.store.sync.localLinks = { docs: "https://legacy" };
  fake.store.sync["link:docs"] = "https://new";
  await get("getLinks()");
  assert.equal(fake.store.sync["link:docs"], "https://new");
  assert.equal("localLinks" in fake.store.sync, false);
});

test("migration: of legacy keys that differ only in case the exact lowercase one wins, else the last", async () => {
  const { fake, get } = sb();
  fake.store.sync.localLinks = {
    Docs: "https://upper",
    docs: "https://lower",
    Wiki: "https://one",
    WIKI: "https://two",
  };
  await get("getLinks()");
  assert.equal(fake.store.sync["link:docs"], "https://lower");
  assert.equal(fake.store.sync["link:wiki"], "https://two");
  assert.equal(Object.keys(fake.store.sync).filter((k) => k.toLowerCase() !== k && k !== "localLinks").length, 0);
});

test("migration: idempotent, a second run (or another device) writes nothing more", async () => {
  const { fake, get } = sb();
  fake.store.sync.localLinks = { docs: "https://d" };
  await get("getLinks()");
  const snapshot = JSON.stringify(fake.store.sync);
  const sets = countSets(fake);
  await get("getLinks()");
  assert.deepEqual(sets, []);
  assert.equal(JSON.stringify(fake.store.sync), snapshot);
});

test("migration: one storage.set for the new items, then the legacy items are removed", async () => {
  const { fake, get } = sb();
  fake.store.sync.localLinks = { docs: "https://d" };
  const sets = countSets(fake);
  const removes = [];
  const remove = fake.api.storage.sync.remove;
  fake.api.storage.sync.remove = (k) => (removes.push(k), remove(k));
  await get("getLinks()");
  assert.equal(sets.length, 1);
  assert.equal(JSON.stringify(removes), '[["localLinks"]]');
});

test("migration: an old-version device writing localLinks again is migrated on the next start", async () => {
  const { fake, get } = sb();
  await get("getLinks()");
  delete fake.store.sync["link:docs"];
  fake.store.sync.localLinks = { docs: "https://again" };
  await get("getLinks()");
  assert.equal(fake.store.sync["link:docs"], "https://again");
  assert.equal("localLinks" in fake.store.sync, false);
});

test("get_rule: the case-insensitive match is explicit, for static and %s rules", () => {
  const { get } = sb();
  assert.equal(get('get_rule("gh", "https://github.com")').condition.isUrlFilterCaseSensitive, false);
  assert.equal(get('get_rule("cs", "https://x/%s")').condition.isUrlFilterCaseSensitive, false);
});

test("get_rule: the name is matched lowercased", () => {
  assert.equal(sb().get('get_rule("GH", "https://github.com")').condition.regexFilter, "^https?://go/gh$");
});

test("get_rule: a %s parameter keeps its case (the substitution does not touch it)", () => {
  const rule = sb().get('get_rule("CS", "https://x/?q=%s")');
  const m = new RegExp(rule.condition.regexFilter, "i").exec("https://go/cs/FooBar");
  assert.equal(
    "https://go/cs/FooBar".replace(
      new RegExp(rule.condition.regexFilter, "i"),
      rule.action.redirect.regexSubstitution.replace("\\1", "$1"),
    ),
    "https://x/?q=FooBar",
  );
  assert.equal(m[1], "FooBar");
});

test("lowercaseLinks: of two stored keys that differ only in case the exact lowercase one wins, else the last", () => {
  const { get } = sb();
  const m = (links) => JSON.parse(JSON.stringify(get(`lowercaseLinks(${JSON.stringify(links)})`)));
  assert.deepEqual(m({ Cs: "https://c" }), { cs: "https://c" });
  assert.deepEqual(m({ gh: "https://lower", GH: "https://upper" }), { gh: "https://lower" });
  assert.deepEqual(m({ GH: "https://upper", gh: "https://lower" }), { gh: "https://lower" });
  assert.deepEqual(m({ Gh: "https://one", GH: "https://two" }), { gh: "https://two" });
});

test("readLinks: reads link:* items only, never seeds or writes", async () => {
  const { fake, get } = sb();
  const sets = countSets(fake);
  assert.deepEqual(JSON.parse(JSON.stringify(await get("readLinks()"))), {});
  fake.store.sync["link:x"] = "https://x";
  fake.store.sync["link:GH"] = "https://mine"; // a key in another case reads as the lowercase name
  fake.store.sync["seeded:y"] = true;
  fake.store.sync.localLinks = { z: "https://z" };
  fake.store.sync.other = "https://o";
  assert.deepEqual(JSON.parse(JSON.stringify(await get("readLinks()"))), { x: "https://x", gh: "https://mine" });
  assert.deepEqual(sets, []);
});

test("refreshRules: one rule per lowercased name, so no two rules match the same URL", async () => {
  const { fake, get } = sb();
  fake.store.sync.localLinks = { GH: "https://mine", Docs: "https://d", docs: "https://d2" };
  await get("refreshRules()");
  const filters = fake
    .rules()
    .map((r) => r.condition.regexFilter)
    .filter((f) => f?.startsWith("^https?://go/") && !f.includes("[^/"));
  assert.equal(new Set(filters).size, filters.length);
  assert.equal(filters.filter((f) => f === "^https?://go/gh$").length, 1);
  assert.equal(filters.filter((f) => f === "^https?://go/docs$").length, 1);
  assert.equal(
    fake.rules().find((r) => r.condition.regexFilter === "^https?://go/gh$").action.redirect.url,
    "https://mine",
  );
});

test("refreshRules: overlapping calls never interleave and end on the latest links", async () => {
  const { fake, get } = sb();
  // Hold every dynamic-rule write so that interleaving would be visible.
  let active = 0,
    maxActive = 0;
  const real = fake.api.declarativeNetRequest.updateDynamicRules;
  fake.api.declarativeNetRequest.updateDynamicRules = async (a) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 5));
    try {
      return await real(a);
    } finally {
      active--;
    }
  };
  const runs = [];
  for (let i = 0; i < 8; i++) {
    fake.store.sync.localLinks = { last: `https://v${i}` };
    runs.push(get("refreshRules()"));
  }
  await Promise.all(runs); // would reject with "Duplicate rule ID" without the queue
  assert.equal(maxActive, 1);
  const last = fake.rules().find((r) => r.condition.regexFilter === "^https?://go/last$");
  assert.ok(last);
  assert.equal(last.action.redirect.url, "https://v7");
});

test("refreshRules: a failed update does not block the next one", async () => {
  const { fake, get, logs } = sb();
  const real = fake.api.declarativeNetRequest.updateDynamicRules;
  fake.api.declarativeNetRequest.updateDynamicRules = async () => {
    throw new Error("boom");
  };
  await assert.rejects(get("refreshRules()"), /boom/);
  fake.api.declarativeNetRequest.updateDynamicRules = real;
  await get("refreshRules()");
  assert.ok(fake.rules().length > 0);
  assert.ok(logs.some(([l]) => l === "error"));
});

test("the storage listener refreshes rules only for sync changes to link:* items", async () => {
  const { fake } = sb();
  const [listener] = fake.listeners.storageChanged;
  await listener({ "link:x": {} }, "local");
  await listener({ other: {}, "seeded:x": {}, localLinks: {} }, "sync");
  assert.equal(fake.calls.length, 0);
  await listener({ "link:x": {} }, "sync");
  assert.equal(fake.calls.length, 1);
});
