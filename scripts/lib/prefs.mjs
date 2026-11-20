// The Firefox prefs the debugger server needs, read from and added to a profile.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const REQUIRED_PREFS = [
  { name: "devtools.debugger.remote-enabled", value: true, why: "lets Firefox run the remote debugger server" },
  { name: "devtools.debugger.prompt-connection", value: false, why: "stops Firefox asking you to approve every connection" },
  { name: "devtools.chrome.enabled", value: true, why: "lets debugger clients reach the browser itself, which add-on install needs" },
];

const line = ({ name, value }) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});`;

function readPrefs(file) {
  const prefs = new Map();
  if (!existsSync(file)) return prefs;
  for (const m of readFileSync(file, "utf8").matchAll(/^\s*user_pref\(\s*"([^"]+)"\s*,\s*(.+?)\s*\)\s*;/gm)) {
    try {
      prefs.set(m[1], JSON.parse(m[2]));
    } catch {}
  }
  return prefs;
}

/** Required prefs whose effective value (user.js over prefs.js) is not the wanted one. */
export function missingPrefs(profileDir) {
  const effective = new Map([...readPrefs(path.join(profileDir, "prefs.js")), ...readPrefs(path.join(profileDir, "user.js"))]);
  return REQUIRED_PREFS.filter((p) => effective.get(p.name) !== p.value);
}

/** Append the given prefs to user.js. Returns the exact lines written. */
export function applyPrefs(profileDir, prefs) {
  if (prefs.length === 0) return [];
  const lines = prefs.map(line);
  const file = path.join(profileDir, "user.js");
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  const lead = existing && !existing.endsWith("\n") ? "\n" : "";
  appendFileSync(file, `${lead}${lines.join("\n")}\n`);
  return lines;
}
