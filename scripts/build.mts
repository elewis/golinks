// Assembles dist/<browser>/ from common/ and <browser>/. There is no compiler:
// each .ts file is emitted as .js with its types blanked out by Node's own
// stripTypeScriptTypes (erasable syntax only, so line and column numbers stay
// the same); every other file is copied byte for byte. A name present in both
// folders, counting the emitted name (x.ts and x.js clash), is an error:
// nothing is overridden silently.
//   node scripts/build.mts [chrome|firefox ...]   (default: both)
import { stripTypeScriptTypes } from "node:module";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BROWSERS: readonly string[] = ["chrome", "firefox"];

/** The name a source file has in dist/: x.ts becomes x.js, anything else is unchanged. */
export function emittedName(name: string): string {
  return name.endsWith(".ts") ? name.slice(0, -3) + ".js" : name;
}

/** TypeScript source to JavaScript: types blanked out, everything else untouched. Throws on non-erasable syntax. */
export function stripTypes(source: string): string {
  // stripTypeScriptTypes prints an ExperimentalWarning on every call; drop just that one.
  const emit = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const type = typeof rest[0] === "string" ? rest[0] : (rest[0] as { type?: string } | undefined)?.type;
    if (type === "ExperimentalWarning") return;
    return (emit as (...a: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    return stripTypeScriptTypes(source, { mode: "strip" });
  } finally {
    process.emitWarning = emit;
  }
}

/** The JavaScript a source file runs as: a .ts file stripped, anything else as is. Used by the build and by the unit-test sandbox. */
export function emittedSource(file: string): string {
  const text = readFileSync(file, "utf8");
  if (!file.endsWith(".ts")) return text;
  try {
    return stripTypes(text);
  } catch (e) {
    throw new Error(`${path.relative(REPO, file)}: ${(e as Error).message}`, { cause: e });
  }
}

/** Copies the folders into a fresh `dest`; a name present in more than one is an error. */
export function assemble(dest: string, dirs: string[]): string {
  const seen = new Map<string, string>();
  for (const dir of dirs) {
    for (const name of readdirSync(dir).map(emittedName)) {
      if (seen.has(name)) {
        throw new Error(`${path.relative(REPO, seen.get(name)!)}/ and ${path.relative(REPO, dir)}/ both have: ${name}. Rename or remove one.`);
      }
      seen.set(name, dir);
    }
  }
  // Emit every .ts first so a syntax error leaves dest alone.
  const emitted = new Map<string, string>();
  for (const dir of dirs) {
    for (const name of readdirSync(dir)) {
      if (name.endsWith(".ts")) emitted.set(path.join(dir, name), emittedSource(path.join(dir, name)));
    }
  }
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const dir of dirs) {
    cpSync(dir, dest, { recursive: true, filter: (src) => !src.endsWith(".ts") });
  }
  for (const [src, js] of emitted) writeFileSync(path.join(dest, emittedName(path.basename(src))), js);
  return dest;
}

/** Builds `browser` into `dest` (default dist/<browser>), replacing what was there. Returns dest. */
export function build(browser: string, dest: string = path.join(REPO, "dist", browser)): string {
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
    console.error((e as Error).message);
    process.exit(1);
  }
}
