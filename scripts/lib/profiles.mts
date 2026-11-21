// Finding a Firefox profile directory and telling whether Firefox is using it.
import { existsSync, readFileSync, readlinkSync, statSync } from "node:fs";
import path from "node:path";

export type IniSection = Record<string, string>;

export function parseProfilesIni(text: string): Record<string, IniSection> {
  const sections: Record<string, IniSection> = {};
  let current: IniSection | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[(.+)\]$/.exec(line);
    if (header) current = sections[header[1]] = {};
    else if (current && line.includes("=")) {
      const i = line.indexOf("=");
      current[line.slice(0, i)] = line.slice(i + 1);
    }
  }
  return sections;
}

/** Where profiles.ini may live, snap Firefox first. */
export function profileRoots(home: string): string[] {
  return [path.join(home, "snap/firefox/common/.mozilla/firefox"), path.join(home, ".mozilla/firefox")];
}

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** The profile to use: `override` (a directory), else the default one from profiles.ini. */
export function findProfile({ home, override }: { home: string; override?: string }): { dir: string; name: string } {
  if (override) {
    const dir = path.resolve(override);
    if (!isDir(dir)) throw new Error(`The profile directory ${dir} does not exist.`);
    return { dir, name: path.basename(dir) };
  }
  const looked: string[] = [];
  for (const root of profileRoots(home)) {
    const ini = path.join(root, "profiles.ini");
    looked.push(ini);
    if (!existsSync(ini)) continue;
    const sections = parseProfilesIni(readFileSync(ini, "utf8"));
    const profiles = Object.entries(sections)
      .filter(([k]) => /^Profile\d+$/.test(k))
      .map(([, v]) => v);
    const resolve = (p: IniSection): string => (p.IsRelative === "0" ? p.Path : path.join(root, p.Path));
    const install = Object.entries(sections).find(([k, v]) => k.startsWith("Install") && v.Default);
    const chosen =
      (install && profiles.find((p) => p.Path === install[1].Default)) ??
      profiles.find((p) => p.Default === "1") ??
      profiles[0];
    if (chosen) return { dir: resolve(chosen), name: chosen.Name ?? path.basename(chosen.Path) };
  }
  throw new Error(
    `No Firefox profile found. Looked for:\n  ${looked.join("\n  ")}\nPass --profile <dir> or set GOLINKS_FF_PROFILE.`,
  );
}

/** Pid of the Firefox using this profile, from its `lock` symlink, or null. */
export function runningPid(profileDir: string): number | null {
  let target: string;
  try {
    target = readlinkSync(path.join(profileDir, "lock"));
  } catch {
    return null;
  }
  const pid = Number(/\+(\d+)$/.exec(target)?.[1]);
  if (!pid) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM" ? pid : null;
  }
}

/**
 * Whether a running Firefox can take a command line forwarded to it. One started with
 * --no-remote or --headless cannot, and a second `firefox` run against it would only open a
 * "Firefox is already running" window. Unreadable means unknown, which counts as no.
 */
export function acceptsForwardedCommands(pid: number): boolean {
  try {
    const args = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
    return !args.some((a) => /^--?(no-remote|headless)$/.test(a));
  } catch {
    return false;
  }
}
