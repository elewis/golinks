import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMON, load } from "./lib/sandbox.mjs";

const href = (name) => load([...COMMON]).get(`golinkHref(${JSON.stringify(name)})`);

test("golinkHref is https://go/<name>", () => {
  assert.equal(href("github"), "https://go/github");
  assert.equal(href("help"), "https://go/help");
});

test("characters that are valid in a path stay as they are (the rules match the URL as typed)", () => {
  assert.equal(href("a.b"), "https://go/a.b");
  assert.equal(href("c++"), "https://go/c++");
});

test("a percent sign and unicode are encoded", () => {
  assert.equal(href("100%"), "https://go/100%25");
  assert.equal(href("café"), "https://go/caf%C3%A9");
});
