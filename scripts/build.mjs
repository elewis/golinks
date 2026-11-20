// Assembles dist/<browser>/ from common/ and <browser>/. Plain copy, Node
// built-ins only. A file name present in both folders is an error: nothing is
// overridden silently.
//   node scripts/build.mjs [chrome|firefox ...]   (default: both)
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BROWSERS = ["chrome", "firefox"];

/** Copies the folders into a fresh `dest`; a name present in more than one is an error. */
export function assemble(dest, dirs) {
  const seen = new Map();
  for (const dir of dirs) {
    for (const name of readdirSync(dir)) {
      if (seen.has(name)) {
        throw new Error(`${path.relative(REPO, seen.get(name))}/ and ${path.relative(REPO, dir)}/ both have: ${name}. Rename or remove one.`);
      }
      seen.set(name, dir);
    }
  }
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const dir of dirs) cpSync(dir, dest, { recursive: true });
  return dest;
}

/** Builds `browser` into `dest` (default dist/<browser>), replacing what was there. Returns dest. */
export function build(browser, dest = path.join(REPO, "dist", browser)) {
  if (!BROWSERS.includes(browser)) throw new Error(`unknown browser "${browser}"; expected ${BROWSERS.join(" or ")}`);
  return assemble(dest, [path.join(REPO, "common"), path.join(REPO, browser)]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const wanted = process.argv.slice(2);
  try {
    for (const b of wanted.length ? wanted : BROWSERS) {
      console.log(`built ${path.relative(REPO, build(b))}/`);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
