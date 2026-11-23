import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMON, load } from "./lib/sandbox.mjs";

const sb = () => {
  const s = load([...COMMON, "common/redirects.ts", "common/redirectlog.ts"]);
  s.fake.store.local.redirectLogEnabled = true; // the log is off by default
  return s;
};
const plain = (v) => JSON.parse(JSON.stringify(v));
const tick = () => new Promise((r) => setTimeout(r, 0));
/** The whole stored log in order, or undefined when nothing is stored. */
const flat = (fake) => {
  const keys = Object.keys(fake.store.local)
    .filter((k) => k.startsWith("redirectLog:"))
    .sort();
  return keys.length ? keys.flatMap((k) => fake.store.local[k]) : undefined;
};
const NF = "chrome-extension://fake-id/notfound.html?name=zz";

/** A started log and a function that feeds it a redirect from the browser. */
function started() {
  const s = sb();
  s.get("startRedirectLog()");
  const [[listener]] = s.fake.listeners.redirect;
  const redirect = (url, redirectUrl, requestId = "1", tabId = 4) => listener({ url, redirectUrl, requestId, tabId });
  return { ...s, redirect, log: () => flat(s.fake) };
}

test("one entry per navigation: { at, from, link, to, tabId }, newest last", async () => {
  const { redirect, log } = started();
  const before = Math.floor(Date.now() / 1000);
  redirect("https://go/github", "https://github.com/", "1", 4);
  redirect("https://go/gh", "https://github.com/", "2", 5);
  await tick();
  assert.equal(log().length, 2);
  const [e, f] = log();
  assert.deepEqual(Object.keys(e).sort(), ["at", "from", "link", "tabId", "to"]);
  assert.deepEqual(
    { ...e, at: 0 },
    { at: 0, from: "https://go/github", link: "github", to: "https://github.com/", tabId: 4 },
  );
  assert.ok(e.at >= before && e.at <= before + 5);
  assert.equal(f.tabId, 5);
});

test("`to` is the resolved destination (%s substituted); the name is lowercase", async () => {
  const { redirect, log } = started();
  redirect("https://go/CS/FooBar", "https://github.com/search?q=FooBar");
  await tick();
  assert.deepEqual(plain(log()[0]).link, "cs");
  assert.equal(log()[0].to, "https://github.com/search?q=FooBar");
  assert.equal(log()[0].from, "https://go/CS/FooBar");
});

test("an unknown name is logged with the not-found page; go/help, bare go/ and other extension pages are not", async () => {
  const { redirect, log } = started();
  redirect("https://go/zz", NF, "1");
  redirect("https://go/help", "chrome-extension://fake-id/index.html", "2");
  redirect("https://go/", "chrome-extension://fake-id/index.html", "3");
  redirect("https://go/x", "chrome-extension://fake-id/popup.html", "4");
  await tick();
  assert.deepEqual(
    log().map((e) => [e.link, e.to]),
    [["zz", NF]],
  );
});

test("a go/ -> go/ hop is no entry; the final entry keeps the first from", async () => {
  const { redirect, log } = started();
  redirect("http://go/gh", "https://go/gh", "1");
  await tick();
  assert.equal(log(), undefined);
  redirect("https://go/gh", "https://github.com/", "1");
  await tick();
  assert.equal(log().length, 1);
  assert.equal(log()[0].from, "http://go/gh");
  assert.equal(log()[0].to, "https://github.com/");
});

test("hops of other requests do not mix", async () => {
  const { redirect, log } = started();
  redirect("http://go/a", "https://go/a", "1");
  redirect("http://go/b", "https://go/b", "2");
  redirect("https://go/b", "https://b.test/", "2");
  redirect("https://go/a", "https://a.test/", "1");
  await tick();
  assert.deepEqual(
    log().map((e) => [e.from, e.to]),
    [
      ["http://go/b", "https://b.test/"],
      ["http://go/a", "https://a.test/"],
    ],
  );
});

test("a noted search joins the go/ hop (and the scheme hop) into one entry", async () => {
  const { redirect, log, get } = started();
  const search = "https://www.google.com/search?q=go%2Fgh";
  get(`noteSearchRedirect("9", ${JSON.stringify(search)})`);
  redirect("https://go/gh", "https://github.com/", "9");
  await tick();
  assert.equal(log().length, 1);
  assert.equal(log()[0].from, search);
  // The note is used up: the next navigation of that id starts fresh.
  redirect("https://go/gh", "https://github.com/", "9");
  await tick();
  assert.equal(log()[1].from, "https://go/gh");

  get(`noteSearchRedirect("10", ${JSON.stringify(search)})`);
  redirect("http://go/gh", "https://go/gh", "10");
  redirect("https://go/gh", "https://github.com/", "10");
  await tick();
  assert.equal(log()[2].from, search);
});

test("a search with no go/ hop logs nothing and the note expires", async () => {
  const { redirect, log, get } = started();
  get(`noteSearchRedirect("5", "https://g.test/?q=go/x", ${Date.now() - 120_000})`);
  assert.equal(get("redirectPending.size"), 1);
  // Any later note or fact prunes the expired one; a fact of that id is not joined.
  redirect("https://go/x", "https://x.test/", "5");
  await tick();
  assert.equal(get("redirectPending.size"), 0);
  assert.equal(log()[0].from, "https://go/x");
  get(`noteSearchRedirect("6", "https://g.test/?q=go/y")`);
  await tick();
  assert.equal(log().length, 1);
});

test("redirects not from go/ are ignored", async () => {
  const { redirect, log } = started();
  redirect("https://example.com/go/x", "https://x.test/");
  await tick();
  assert.equal(log(), undefined);
});

const DAY = 86400;
const e = (at, tabId = 1) => ({ at, from: "f", link: "l", to: "t", tabId });

test("redirectDayKey: the UTC day of `at`; the boundary is UTC midnight", () => {
  const { get } = sb();
  const midnight = Date.parse("2026-03-05T00:00:00Z") / 1000;
  assert.equal(get(`redirectDayKey(${midnight - 1})`), "redirectLog:2026-03-04");
  assert.equal(get(`redirectDayKey(${midnight})`), "redirectLog:2026-03-05");
  assert.equal(get(`redirectDayKey(${midnight + DAY - 1})`), "redirectLog:2026-03-05");
});

test("planRedirectWrite: the entry goes into its day key, newest last; other keys are not rewritten", () => {
  const { get, ctx } = sb();
  const now = Date.parse("2026-03-05T12:00:00Z") / 1000;
  ctx.days = { "redirectLog:2026-03-05": [e(now - 10, 1)], "redirectLog:2026-03-04": [e(now - DAY, 2)] };
  ctx.entry = e(now, 3);
  const plan = plain(get(`planRedirectWrite(days, entry, ${now})`));
  assert.deepEqual(Object.keys(plan.set), ["redirectLog:2026-03-05"]);
  assert.deepEqual(
    plan.set["redirectLog:2026-03-05"].map((x) => x.tabId),
    [1, 3],
  );
  assert.deepEqual(plan.remove, []);
});

test("planRedirectWrite: a key whose day ended more than 7 days ago is removed, one that ended exactly 7 days ago stays", () => {
  const { get, ctx } = sb();
  const now = Date.parse("2026-03-12T00:00:00Z") / 1000; // 7 days after the end of 03-04
  ctx.days = { "redirectLog:2026-03-03": [e(now - 9 * DAY)], "redirectLog:2026-03-04": [e(now - 8 * DAY)] };
  ctx.entry = e(now);
  const plan = plain(get(`planRedirectWrite(days, entry, ${now})`));
  assert.deepEqual(plan.remove, ["redirectLog:2026-03-03"]);
  const later = plain(get(`planRedirectWrite(days, entry, ${now + 1})`));
  assert.deepEqual(later.remove.sort(), ["redirectLog:2026-03-03", "redirectLog:2026-03-04"]);
});

test("planRedirectWrite: the 10,000 cap spans keys and trims the oldest entries, oldest keys first", () => {
  const { get, ctx } = sb();
  const now = Date.parse("2026-03-05T12:00:00Z") / 1000;
  const mk = (n, at, from) => Array.from({ length: n }, (_, i) => e(at, from + i));
  ctx.days = {
    "redirectLog:2026-03-03": mk(100, now - 2 * DAY, 0),
    "redirectLog:2026-03-04": mk(5000, now - DAY, 100),
    "redirectLog:2026-03-05": mk(4900, now - 5, 5100),
  };
  ctx.entry = e(now, 99999);
  // 10,001 entries: one too many, so the oldest key loses its first entry.
  let plan = plain(get(`planRedirectWrite(days, entry, ${now})`));
  assert.equal(plan.set["redirectLog:2026-03-03"].length, 99);
  assert.equal(plan.set["redirectLog:2026-03-03"][0].tabId, 1);
  assert.equal(plan.set["redirectLog:2026-03-05"].length, 4901);
  assert.deepEqual(plan.remove, []);
  // 201 too many: the whole oldest key goes and the next one is trimmed by 101.
  ctx.days["redirectLog:2026-03-05"] = mk(5100, now - 5, 5100);
  plan = plain(get(`planRedirectWrite(days, entry, ${now})`));
  assert.deepEqual(plan.remove, ["redirectLog:2026-03-03"]);
  assert.equal(plan.set["redirectLog:2026-03-04"].length, 4899);
  assert.equal(plan.set["redirectLog:2026-03-04"][0].tabId, 201);
});

test("appendRedirectLog: each entry lands in its UTC day key; readRedirectLog returns them all in order", async () => {
  const { fake, get, ctx } = sb();
  const t = Date.parse("2026-03-05T00:00:00Z") / 1000;
  for (const [i, at] of [t - 1, t, t + 5].entries()) {
    ctx.en = e(at, i);
    await get(`appendRedirectLog(en, ${t + 100})`);
  }
  assert.deepEqual(Object.keys(fake.store.local).sort(), [
    "redirectLog:2026-03-04",
    "redirectLog:2026-03-05",
    "redirectLogEnabled",
  ]);
  ctx.out = await get("readRedirectLog()");
  assert.deepEqual(plain(get("out").map((x) => x.tabId)), [0, 1, 2]);
});

test("appendRedirectLog: expired day keys, also ones from an earlier run, are removed; a write rewrites only its own day", async () => {
  const { fake, get, ctx, logs } = sb();
  const now = Date.parse("2026-03-20T10:00:00Z") / 1000;
  fake.store.local["redirectLog:2026-03-01"] = [e(now - 19 * DAY)];
  fake.store.local["redirectLog:2026-03-18"] = [e(now - 2 * DAY)];
  fake.store.local.linkMetrics = { x: 1 };
  ctx.en = e(now);
  await get(`appendRedirectLog(en, ${now})`);
  assert.deepEqual(Object.keys(fake.store.local).sort(), [
    "linkMetrics",
    "redirectLog:2026-03-18",
    "redirectLog:2026-03-20",
    "redirectLogEnabled",
  ]);
  // Later writes read only the last days: a key far outside is removed by name.
  fake.store.local["redirectLog:2026-02-25"] = [e(now - 23 * DAY)];
  const reads = [];
  const realGet = fake.api.storage.local.get;
  fake.api.storage.local.get = async (k) => (reads.push(k), realGet(k));
  ctx.en2 = e(now + 1);
  await get(`appendRedirectLog(en2, ${now + 1})`);
  assert.ok(Array.isArray(reads.find((k) => k !== "redirectLogEnabled")), "no full read after the first write");
  assert.equal(fake.store.local["redirectLog:2026-02-25"], undefined);
  assert.equal(logs.filter((l) => l[0] === "error").length, 0);
});

test("appendRedirectLog: a burst of 50 keeps every entry in order", async () => {
  const { fake, get, ctx } = sb();
  const runs = [];
  for (let i = 0; i < 50; i++) {
    ctx.entry = { at: Math.floor(Date.now() / 1000), from: "f", link: "l", to: "t", tabId: i };
    runs.push(get("appendRedirectLog(entry)"));
  }
  await Promise.all(runs);
  assert.deepEqual(
    flat(fake).map((x) => x.tabId),
    Array.from({ length: 50 }, (_, i) => i),
  );
});

test("appendRedirectLog: a failing write is logged and does not block the next", async () => {
  const { fake, get, ctx, logs } = sb();
  const real = fake.api.storage.local.set;
  fake.api.storage.local.set = async () => {
    throw new Error("quota");
  };
  const now = Math.floor(Date.now() / 1000);
  ctx.a = { at: now, from: "f", link: "l", to: "t", tabId: 1 };
  await get("appendRedirectLog(a)");
  fake.api.storage.local.set = real;
  ctx.b = { at: now, from: "f", link: "l", to: "t", tabId: 2 };
  await get("appendRedirectLog(b)");
  assert.deepEqual(
    flat(fake).map((x) => x.tabId),
    [2],
  );
  assert.ok(logs.some(([l]) => l === "error"));
});
