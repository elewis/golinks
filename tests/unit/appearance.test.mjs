import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load } from "./lib/sandbox.mjs";

const sb = () => load(["common/api.ts", "common/appearance.ts"]);

test("validAppearance: light and dark are kept, anything else is system", () => {
  const s = sb();
  for (const v of ["light", "dark", "system"]) assert.equal(s.get(`validAppearance(${JSON.stringify(v)})`), v);
  for (const v of [undefined, null, "", "Dark", "auto", 1, {}, ["dark"]])
    assert.equal(s.get(`validAppearance(${JSON.stringify(v)})`), "system", String(v));
});

test("themeAttribute: the data-theme value for a mode, none for system or an invalid value", () => {
  const s = sb();
  assert.equal(s.get('themeAttribute("light")'), "light");
  assert.equal(s.get('themeAttribute("dark")'), "dark");
  assert.equal(s.get('themeAttribute("system")'), null);
  assert.equal(s.get("themeAttribute(undefined)"), null);
  assert.equal(s.get('themeAttribute("sepia")'), null);
});

test("the storage key is `appearance`", () => {
  assert.equal(sb().get("APPEARANCE_KEY"), "appearance");
});

test("theme.css: every colour token is a light-dark() pair, and the modes set color-scheme", () => {
  const css = readFileSync(new URL("../../common/theme.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const root = css.match(/:root \{([\s\S]*?)\n\}/)[1];
  const colours = [...root.matchAll(/^\s*(--(?:color|shadow)-[\w-]+):\s*(.+);$/gm)];
  assert.ok(colours.length >= 15);
  for (const [, name, value] of colours) assert.match(value, /light-dark\(/, `${name} has a dark value`);
  assert.match(root, /color-scheme: light dark;/);
  assert.match(css, /:root\[data-theme="light"\] \{\s*color-scheme: light;/);
  assert.match(css, /:root\[data-theme="dark"\] \{\s*color-scheme: dark;/);
  assert.doesNotMatch(css, /prefers-color-scheme/); // light-dark() follows it by itself
});
