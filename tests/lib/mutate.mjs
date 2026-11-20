// Browser-agnostic: applies the GOLINKS_MUTATE breakage to a throwaway copy.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** MUTATIONS is name -> [file, old, new], or a list of those. No-op when GOLINKS_MUTATE is unset. */
export function applyMutation(dir, MUTATIONS) {
  const mutation = process.env.GOLINKS_MUTATE;
  if (!mutation) return;
  const spec = MUTATIONS[mutation];
  if (!spec) throw new Error(`unknown GOLINKS_MUTATE=${mutation}; known: ${Object.keys(MUTATIONS).join(", ")}`);
  for (const [file, from, to] of Array.isArray(spec[0]) ? spec : [spec]) {
    const p = path.join(dir, file);
    const text = readFileSync(p, "utf8");
    if (!text.includes(from)) throw new Error(`mutation ${mutation}: pattern not found in ${file}`);
    writeFileSync(p, text.replace(from, to));
  }
}
