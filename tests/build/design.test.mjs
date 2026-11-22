import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOW, checkDesign, loadTree } from "../lib/design-guard.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PAGE = '<!doctype html>\n<link rel="stylesheet" href="theme.css">\n';
const rules = (files) => checkDesign(files, []).map((v) => `${v.rule}:${v.file}:${v.line}`);

test("the real tree follows the design system", () => {
  const found = checkDesign(loadTree(REPO), ALLOW);
  assert.deepEqual(
    found.map((v) => v.message),
    [],
  );
});

test("allowlist entries name a reason", () => {
  for (const a of ALLOW) assert.ok(a.file && a.line && a.rule && a.reason, JSON.stringify(a));
});

test("colour literals outside theme.css are caught, theme.css itself is not", () => {
  const css = "#add-link { margin: 0 }\n.a { color: #fff; }\n.b {\n  background: rgba(0, 0, 0, .1);\n}\n";
  assert.deepEqual(rules([{ path: "common/x.css", text: css }]), ["colour:common/x.css:2", "colour:common/x.css:4"]);
  assert.deepEqual(rules([{ path: "common/theme.css", text: ":root { --c: #fff; }" }]), []);
  assert.deepEqual(rules([{ path: "common/x.css", text: ".a { border: 1px solid #1a2230; }" }]), [
    "colour:common/x.css:1",
  ]);
  assert.deepEqual(rules([{ path: "common/x.css", text: ".a { color: hsl(10 20% 30%); }" }]), [
    "colour:common/x.css:1",
  ]);
  assert.deepEqual(rules([{ path: "common/x.css", text: ".a { color: white; background: Red }" }]), [
    "colour:common/x.css:1",
    "colour:common/x.css:1",
  ]);
});

test("colour literals in html and ts are caught", () => {
  assert.deepEqual(rules([{ path: "common/p.html", text: `${PAGE}<svg><path fill="#abc"/></svg>\n` }]), [
    "colour:common/p.html:3",
  ]);
  assert.deepEqual(rules([{ path: "firefox/p.ts", text: 'const c = "rgb(1, 2, 3)";\n' }]), ["colour:firefox/p.ts:1"]);
  assert.deepEqual(rules([{ path: "chrome/p.html", text: `${PAGE}<path stroke="red"/>\n` }]), [
    "colour:chrome/p.html:3",
  ]);
});

test("things that look like colours but are not pass", () => {
  const ok = [
    { path: "common/a.ts", text: 'q("#add-link"); q("#fade"); const u = "https://x.test/#abc123"; // #fff red\n' },
    {
      path: "common/a.html",
      text: `${PAGE}<!-- fill="#fff" -->\n<a href="#add">x</a><path fill="currentColor" stroke="none"/>\n`,
    },
    { path: "common/a.css", text: "/* color: #fff; */\n#cafe { color: var(--color-text); fill: currentColor; }\n" },
  ];
  ok.push({ path: "common/b.ts", text: "for (const n of rule.style) v(rule.style.getPropertyValue(n));\n" });
  assert.deepEqual(rules(ok), []);
});

test("inline styles are caught in common ts and html", () => {
  assert.deepEqual(rules([{ path: "common/a.ts", text: 'el.style.display = "none";\n' }]), [
    "inline-style:common/a.ts:1",
  ]);
  assert.deepEqual(rules([{ path: "common/a.ts", text: 'el.setAttribute("style", "x");\n' }]), [
    "inline-style:common/a.ts:1",
  ]);
  assert.deepEqual(rules([{ path: "common/a.html", text: `${PAGE}<p style="margin:0">x</p>\n<style>p{}</style>\n` }]), [
    "inline-style:common/a.html:3",
    "inline-style:common/a.html:4",
  ]);
});

test("an html page without theme.css is caught", () => {
  assert.deepEqual(rules([{ path: "common/a.html", text: "<!doctype html>\n<p>x</p>\n" }]), [
    "theme-link:common/a.html:1",
  ]);
  assert.deepEqual(rules([{ path: "firefox/a.html", text: '<link rel="stylesheet" href="other.css">' }]), [
    "theme-link:firefox/a.html:1",
  ]);
});

test("messages name the file and line and say what to do", () => {
  const [a, c, b] = checkDesign(
    [
      { path: "common/a.css", text: ".a { color: #fff }" },
      { path: "common/a.ts", text: "x.style.a = 1;" },
      { path: "common/a.html", text: "<p></p>" },
    ],
    [],
  );
  assert.match(a.message, /common\/a\.css:1/);
  assert.match(a.message, /token from common\/theme\.css/);
  assert.match(b.message, /common\/a\.ts:1/);
  assert.match(b.message, /class/);
  assert.match(c.message, /common\/a\.html:1/);
  assert.match(c.message, /link theme\.css/);
});

test("an allowlist entry silences exactly its file, line and rule", () => {
  const files = [{ path: "common/a.ts", text: "x.style.a = 1;\ny.style.b = 2;\n" }];
  const allow = [{ file: "common/a.ts", line: 1, rule: "inline-style", reason: "test" }];
  assert.deepEqual(
    checkDesign(files, allow).map((v) => v.line),
    [2],
  );
});
