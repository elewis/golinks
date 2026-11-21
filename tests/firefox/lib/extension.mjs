// Builds the throwaway copy of the Firefox extension (common/ + firefox/, via
// scripts/build.mts) that the tests install. Neither folder is modified.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyMutation } from "../../lib/mutate.mjs";
import { build } from "../../../scripts/build.mts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "../../..");
// Must live under the repo (git-ignored): the snap-confined Firefox cannot
// see /tmp, but can see non-hidden paths under $HOME.
const BUILD = path.join(REPO, "tests/firefox/.build");

const LOADED_LINE = 'console.debug("GoLinks: extension loaded");';

// Deliberate breakages for showing that a check can go red. Select one with
// GOLINKS_MUTATE=<name> pnpm test. name -> [file, old, new]
export const MUTATIONS = {
  "no-load-log": ["rules.js", LOADED_LINE, ""],
  "js-error": ["rules.js", LOADED_LINE, `${LOADED_LINE} undefinedFunction();`],
  "no-rules": ["rules.js", "addRules: rules_to_add,", "addRules: [],"],
  "drop-gh-link": ["links.js", '    gh: "https://github.com",\n', ""],
  "bad-param-link": ["links.js", "https://github.com/search?q=%s", "https://example.invalid/?q=%s"],
  "no-help-rule": ["rules.js", 'urlFilter: "||go/help|"', 'urlFilter: "||go/helpx|"'],
  "no-root-rule": ["rules.js", 'urlFilter: "||go/|"', 'urlFilter: "||go/rootx|"'],
  "no-notfound-rule": ["rules.js", 'urlFilter: "||go/*"', 'urlFilter: "||go/zzz*"'],
  // Simulates a regression where "go/" anywhere in a query value (not just at its start) is redirected.
  "hijack-go-substring": ["search.js", "query.match(/^go\\/", "query.match(/go\\/"],
  // Simulates losing the narrowing: link clicks and form submits from a page are redirected too.
  "redirect-from-pages": ["background.js", "if (details.originUrl) {", "if (false) {"],
  "no-interception-cap": ["search.js", "interceptions.slice(-MAX_INTERCEPTIONS)", "interceptions"],
  "interception-race": ["search.js", "interceptionsQueue = interceptionsQueue\n    .then(", "interceptionsQueue = Promise.resolve()\n    .then("],
  "delete-noop": ["index.js", "delete current[golink];", ""],
  "no-storage-refresh": ["rules.js", 'namespace === "sync" &&', 'namespace === "never" &&'],
};

// WebDriver cannot script moz-extension:// pages, so the copy gets a test
// pages (web accessible) reachable at https://go/zztest-<op> through static
// declarativeNetRequest rules that outrank the extension's own rules. The
// operation travels in the redirect's query string (a fragment is dropped by
// the redirect) and the page reports back through its own URL fragment.
const HARNESS_RULES = ["add", "del", "writes", "burst", "addlink", "seed", "frame", "regex", "log", "flood"].map((op, i) => ({
  id: i + 1,
  priority: 100,
  action: { type: "redirect", redirect: { extensionPath: `/test.html?op=${op}` } },
  condition: { urlFilter: `||go/zztest-${op}|`, resourceTypes: ["main_frame"] },
}));

export function buildExtension() {
  const root = path.join(BUILD, `${process.pid}-${randomBytes(3).toString("hex")}`);
  const dir = path.join(root, "ext");
  mkdirSync(root, { recursive: true });
  build("firefox", dir);

  for (const f of ["test.html", "test.js"]) {
    cpSync(path.join(HERE, "../harness", f), path.join(dir, f));
  }
  writeFileSync(path.join(dir, "harness-rules.json"), JSON.stringify(HARNESS_RULES));
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.web_accessible_resources[0].resources.push("test.html", "popup.html");
  manifest.declarative_net_request = {
    rule_resources: [{ id: "harness", enabled: true, path: "harness-rules.json" }],
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  applyMutation(dir, MUTATIONS);
  return { root, dir };
}

export function removeBuild(root) {
  rmSync(root, { recursive: true, force: true });
}
