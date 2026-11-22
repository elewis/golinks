// The design-system guard: pure checks over source text (see tests/build/design.test.mjs).
// Rules (CLAUDE.md "Design system"): every colour lives in common/theme.css as a token, pages style through classes
// (never inline), and every extension page links theme.css.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const THEME = "common/theme.css";
export const DIRS = ["common", "chrome", "firefox"];
export const EXTENSIONS = [".ts", ".html", ".css", ".svg"];

// Unavoidable uses: { file, line, rule: "colour" | "inline-style" | "theme-link", reason }. Empty on purpose.
export const ALLOW = [];

const NAMED_COLOURS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood " +
    "cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray " +
    "darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen " +
    "darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue " +
    "firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew " +
    "hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
    "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray " +
    "lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue " +
    "mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred " +
    "midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid " +
    "palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple " +
    "rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue " +
    "slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white " +
    "whitesmoke yellow yellowgreen"
  ).split(" "),
);

const HEX = "#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\\w-])";
const FUNC = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/g;
// A property that takes a colour, for hex and named colours outside a css declaration (html, ts, svg).
const COLOUR_PROP = /\b(?:color|background(?:-color)?|border(?:-[a-z]+)*|outline|fill|stroke|shadow|stop-color)\b/;
const CSS_COLOUR_DECL =
  /(^|[;{}\s])(color|background(?:-[a-z]+)?|border(?:-[a-z]+)*|outline(?:-[a-z]+)?|fill|stroke|box-shadow|text-shadow|caret-color|accent-color)\s*:\s*([^;}]*)/g;
const ATTR_COLOUR = /\b(?:fill|stroke|color|stop-color)\s*=\s*["']([a-zA-Z]+)["']/g;

const blank = (s) => s.replace(/[^\n]/g, " ");

// Comments become spaces (newlines kept) so line numbers stay true and a colour in a comment is not a violation.
function stripComments(file, text) {
  if (file.endsWith(".css")) return text.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (file.endsWith(".html") || file.endsWith(".svg")) return text.replace(/<!--[\s\S]*?-->/g, blank);
  return text
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:\w"'`\\])\/\/[^\n]*/g, (m, p) => p + blank(m.slice(p.length)));
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

function colourHits(file, clean) {
  const hits = []; // [index, what]
  for (const m of clean.matchAll(FUNC)) hits.push([m.index, m[0]]);
  if (file.endsWith(".css")) {
    // A hex colour is a declaration value, i.e. inside braces; `#id {` selectors are outside.
    let depth = 0;
    const inBraces = [];
    for (const ch of clean) inBraces.push((ch === "{" ? depth++ : ch === "}" ? depth-- : 0, depth > 0));
    for (const m of clean.matchAll(new RegExp(HEX, "g"))) if (inBraces[m.index]) hits.push([m.index, m[0]]);
    for (const m of clean.matchAll(CSS_COLOUR_DECL)) {
      const value = m[3].replace(/var\(\s*--[\w-]+/g, (v) => " ".repeat(v.length));
      const start = m.index + m[0].length - m[3].length;
      for (const w of value.matchAll(/[a-zA-Z]+/g))
        if (NAMED_COLOURS.has(w[0].toLowerCase())) hits.push([start + w.index, w[0]]);
    }
  } else {
    // html/ts/svg: a hex counts only on a line that also names a colour property, so `"#add-link"` selectors pass.
    let offset = 0;
    for (const line of clean.split("\n")) {
      for (const m of line.matchAll(new RegExp(HEX, "g"))) {
        if (COLOUR_PROP.test(line.slice(0, m.index))) hits.push([offset + m.index, m[0]]);
      }
      offset += line.length + 1;
    }
    for (const m of clean.matchAll(ATTR_COLOUR)) {
      if (NAMED_COLOURS.has(m[1].toLowerCase())) hits.push([m.index, m[0]]);
    }
  }
  return hits;
}

/** files: [{ path: "common/x.css" (repo-relative, /), text }]. Returns [{ file, line, rule, message }]. */
export function checkDesign(files, allow = ALLOW) {
  const found = [];
  const add = (file, line, rule, message) => found.push({ file, line, rule, message: `${file}:${line}: ${message}` });
  for (const { path: file, text } of files) {
    const clean = stripComments(file, text);
    if (file !== THEME) {
      for (const [i, what] of colourHits(file, clean)) {
        add(
          file,
          lineOf(clean, i),
          "colour",
          `colour literal ${what}. Use a token from common/theme.css (var(--color-...)), or add one there.`,
        );
      }
    }
    const isScript = file.endsWith(".ts") && file.startsWith("common/");
    const isPage = file.endsWith(".html");
    if (isScript || (isPage && file.startsWith("common/"))) {
      const inline = [
        /\.style\s*=(?!=)|\.style\.(?!getPropertyValue\b)/g,
        /\bsetAttribute\(\s*["']style["']/g,
        /\bstyle\s*=\s*["']/g,
        /<style\b/g,
      ];
      for (const re of inline) {
        for (const m of clean.matchAll(re)) {
          add(
            file,
            lineOf(clean, m.index),
            "inline-style",
            `inline style (${m[0].trim()}). Use a class from common/theme.css instead, or add one there.`,
          );
        }
      }
    }
    if (isPage && !/<link\b[^>]*href\s*=\s*["']theme\.css["']/.test(clean)) {
      add(
        file,
        1,
        "theme-link",
        'page does not link theme.css. Add <link rel="stylesheet" href="theme.css"> to its <head>.',
      );
    }
  }
  found.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const key = (f, l, r) => `${f}\0${l}\0${r}`;
  const allowed = new Set(allow.map((a) => key(a.file, a.line, a.rule)));
  return found.filter(
    (v, i) => !allowed.has(key(v.file, v.line, v.rule)) && !(i && found[i - 1].message === v.message),
  );
}

/** Every shipped source file of common/, chrome/ and firefox/ as { path, text }. */
export function loadTree(root) {
  const files = [];
  for (const dir of DIRS) {
    for (const f of readdirSync(path.join(root, dir))) {
      if (EXTENSIONS.some((e) => f.endsWith(e)))
        files.push({ path: `${dir}/${f}`, text: readFileSync(path.join(root, dir, f), "utf8") });
    }
  }
  return files;
}
