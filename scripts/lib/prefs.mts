// The Firefox prefs the debugger server needs, read from and added to a profile.
import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface Pref {
  name: string;
  value: boolean;
  why: string;
}

export const REQUIRED_PREFS: readonly Pref[] = [
  { name: "devtools.debugger.remote-enabled", value: true, why: "lets Firefox run the remote debugger server" },
  { name: "devtools.debugger.prompt-connection", value: false, why: "stops Firefox asking you to approve every connection" },
  { name: "devtools.chrome.enabled", value: true, why: "lets debugger clients reach the browser itself, which add-on install needs" },
];

const line = ({ name, value }: Pick<Pref, "name" | "value">): string => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});`;

function readPrefs(file: string): Map<string, unknown> {
  const prefs = new Map<string, unknown>();
  if (!existsSync(file)) return prefs;
  for (const m of readFileSync(file, "utf8").matchAll(/^\s*user_pref\(\s*"([^"]+)"\s*,\s*(.+?)\s*\)\s*;/gm)) {
    try {
      prefs.set(m[1], JSON.parse(m[2]));
    } catch {}
  }
  return prefs;
}

function effectivePrefs(profileDir: string): Map<string, unknown> {
  return new Map([...readPrefs(path.join(profileDir, "prefs.js")), ...readPrefs(path.join(profileDir, "user.js"))]);
}

/** Required prefs the profile already has set the wanted way (by the user, or left by an older version of the loader). */
export function existingPrefs(profileDir: string): Pref[] {
  const effective = effectivePrefs(profileDir);
  return REQUIRED_PREFS.filter((p) => effective.get(p.name) === p.value);
}

/** Required prefs the profile sets to the opposite value. The loader will not override those. */
export function conflictingPrefs(profileDir: string): Pref[] {
  const effective = effectivePrefs(profileDir);
  return REQUIRED_PREFS.filter((p) => effective.has(p.name) && effective.get(p.name) !== p.value);
}

/** Required prefs whose effective value (user.js over prefs.js) is not the wanted one. */
export function missingPrefs(profileDir: string): Pref[] {
  const effective = effectivePrefs(profileDir);
  return REQUIRED_PREFS.filter((p) => effective.get(p.name) !== p.value);
}

/** Append the given prefs to user.js. Returns the exact lines written. */
export function applyPrefs(profileDir: string, prefs: readonly Pref[]): string[] {
  if (prefs.length === 0) return [];
  const lines = prefs.map(line);
  const file = path.join(profileDir, "user.js");
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  const lead = existing && !existing.endsWith("\n") ? "\n" : "";
  appendFileSync(file, `${lead}${lines.join("\n")}\n`);
  return lines;
}

/**
 * Undo applyPrefs: remove exactly the lines it returned (user.js is only read
 * at startup, so once Firefox is up they are no longer needed). `created` says
 * the loader made user.js; it is deleted again if nothing else is left in it.
 */
export function removePrefs(profileDir: string, lines: readonly string[], created: boolean): void {
  const file = path.join(profileDir, "user.js");
  if (!existsSync(file) || lines.length === 0) return;
  const kept = readFileSync(file, "utf8").split("\n").filter((l) => !lines.includes(l));
  const text = kept.join("\n");
  if (created && text.trim() === "") unlinkSync(file);
  else writeFileSync(file, text);
}

/**
 * Chrome-side script that moves each pref from the user branch (which Firefox
 * saves to prefs.js) to the default branch (which it never saves). The values
 * stay in force for this session, so the debugger server can be reopened,
 * and are gone when Firefox quits.
 *
 * Firefox's own startup save already wrote the user.js values into prefs.js,
 * and the save that would remove them again is debounced (about 500 ms) and
 * skipped when Firefox is stopped with SIGTERM in that time. So the script
 * saves prefs.js itself and waits for the write.
 */
export function movePrefsScript(prefs: readonly Pref[]): string {
  return `(async function () {
  for (const [name, value] of ${JSON.stringify(prefs.map((p) => [p.name, p.value]))}) {
    if (Services.prefs.prefHasUserValue(name)) Services.prefs.clearUserPref(name);
    Services.prefs.getDefaultBranch("").setBoolPref(name, value);
  }
  await Services.prefs.savePrefFile(null);
  return "moved";
})()`;
}
