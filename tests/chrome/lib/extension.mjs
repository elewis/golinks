// Builds the throwaway copy of the Chrome extension (common/ + chrome/, via
// scripts/build.mts) that the tests install. Neither folder is modified.
import { mkdirSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyMutation } from "../../lib/mutate.mjs";
import { build } from "../../../scripts/build.mts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "../../..");
// Under the repo and git-ignored, like the Firefox suite's build directory.
const BUILD = path.join(REPO, "tests/chrome/.build");

const LOADED_LINE = 'console.debug("GoLinks: extension loaded");';

// Deliberate breakages for showing that a check can go red. Select one with
// GOLINKS_MUTATE=<name> pnpm test:chrome. name -> [file, old, new]
export const MUTATIONS = {
  "no-load-log": ["rules.js", LOADED_LINE, ""],
  "js-error": ["rules.js", LOADED_LINE, `${LOADED_LINE} undefinedFunction();`],
  "no-rules": ["rules.js", "addRules: rules_to_add,", "addRules: [],"],
  "drop-gh-link": ["links.js", '    gh: "https://github.com",\n', ""],
  "bad-param-link": ["links.js", "https://github.com/search?q=%s", "https://example.invalid/?q=%s"],
  "no-help-rule": ["rules.js", 'urlFilter: "||go/help|"', 'urlFilter: "||go/helpx|"'],
  "no-root-rule": ["rules.js", 'urlFilter: "||go/|"', 'urlFilter: "||go/rootx|"'],
  "no-notfound-rule": ["rules.js", 'urlFilter: "||go/*"', 'urlFilter: "||go/zzz*"'],
  // Simulates a regression where every URL containing go/ is redirected (the
  // extension also needs host access to those sites for the rule to apply).
  "hijack-go-substring": [
    ["rules.js", 'urlFilter: "||go/*"', 'urlFilter: "go/*"'],
    ["manifest.json", '"https://go/"', '"https://go/", "https://github.com/"'],
  ],
  "delete-noop": ["index.js", "delete current[golink];", ""],
  "no-storage-refresh": ["rules.js", 'namespace === "sync" &&', 'namespace === "never" &&'],
};

export function buildExtension() {
  const root = path.join(BUILD, `${process.pid}-${randomBytes(3).toString("hex")}`);
  const dir = path.join(root, "ext");
  mkdirSync(root, { recursive: true });
  build("chrome", dir);
  applyMutation(dir, MUTATIONS);
  return { root, dir, profile: path.join(root, "profile") };
}

export function removeBuild(root) {
  rmSync(root, { recursive: true, force: true });
}
