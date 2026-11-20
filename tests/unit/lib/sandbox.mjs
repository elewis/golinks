// Loads the extension's classic scripts (common/, firefox/) into a node:vm
// context with a fake `browser`, the way a browser would run them: one shared
// global scope, no modules. No browser, no network.
import vm from "node:vm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO } from "../../../scripts/build.mjs";

/** An in-memory stand-in for the parts of the WebExtension API the scripts use. */
export function fakeApi() {
  const store = { sync: {}, local: {} };
  const calls = [];
  const area = (name) => ({
    async get(keys) {
      const all = store[name];
      if (keys == null) return structuredClone(all);
      const list = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      return structuredClone(Object.fromEntries(list.filter((k) => k in all).map((k) => [k, all[k]])));
    },
    async set(items) {
      Object.assign(store[name], structuredClone(items));
    },
  });
  let rules = [];
  const listeners = { storageChanged: [], webRequest: [] };
  const api = {
    storage: { sync: area("sync"), local: area("local"), onChanged: { addListener: (f) => listeners.storageChanged.push(f) } },
    declarativeNetRequest: {
      async getDynamicRules() {
        return structuredClone(rules);
      },
      // Mirrors the browser: a duplicate id among the survivors and additions is an error.
      async updateDynamicRules({ removeRuleIds = [], addRules = [] }) {
        calls.push({ removeRuleIds, addRules });
        const kept = rules.filter((r) => !removeRuleIds.includes(r.id));
        const ids = [...kept, ...addRules].map((r) => r.id);
        if (new Set(ids).size !== ids.length) throw new Error("Duplicate rule ID");
        rules = [...kept, ...structuredClone(addRules)];
      },
    },
    webRequest: { onBeforeRequest: { addListener: (...args) => listeners.webRequest.push(args) } },
    permissions: { contains: async () => true },
  };
  return { api, store, calls, listeners, rules: () => rules };
}

/**
 * Runs the given repo-relative scripts in order in one fresh context.
 * Returns { fake, ctx, get(expr), logs }; get evaluates an expression in the
 * scripts' scope (needed for top-level const/let, which are not properties).
 */
export function load(files, fake = fakeApi()) {
  const logs = [];
  const sink = (level) => (...a) => logs.push([level, ...a]);
  const ctx = vm.createContext({
    browser: fake.api,
    console: { debug: sink("debug"), log: sink("log"), warn: sink("warn"), error: sink("error") },
    URL,
    structuredClone,
  });
  for (const f of files) vm.runInContext(readFileSync(path.join(REPO, f), "utf8"), ctx, { filename: f });
  return { fake, ctx, logs, get: (expr) => vm.runInContext(expr, ctx) };
}

export const COMMON = ["common/api.js", "common/links.js", "common/rules.js"];
