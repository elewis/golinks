// pnpm screenshot [firefox|chrome|both] [page ...] [--dark] [--appearance light|dark|system]
//
// Builds the extension, installs it in headless Firefox and/or Chrome (the
// test harnesses in tests/*/lib), stores a few sample links, and saves a PNG
// of each page to .screenshots/<browser>/<page>.png (git-ignored). For checking
// a UI change by eye: it is not a test. Needs the same programs as the browser
// suites (see CLAUDE.md); hold the hive lease "browser-suites" while it runs.
//
// Appearance: by default the stored choice is none (System) and the browser is light. --dark emulates a dark
// system (Chrome: Emulation.setEmulatedMedia; Firefox: layout.css.prefers-color-scheme.content-override in the
// throwaway test profile only) and saves <page>-dark.png. --appearance <mode> stores that choice (Light or Dark
// ignore the emulation) and saves <page>-<mode>.png.
//
// Pages: popup, not-found, help, help-sorted (go/help sorted by hits), help-dialog (go/help with the reset confirmation open), popup-saved (the popup just after a save), overwrite (the popup after saving over a taken
// name), help-empty / help-error / help-overwrite (go/help with no user links, a
// validation error, the overwrite confirm), styleguide (the design system page, linked from no UI), or any extension page path with a query string, e.g. "notfound.html?name=x".
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { REPO } from "./build.mts";

interface Shot {
  label: string;
  src: string;
  // element id -> value, typed in the way a user would
  fill?: Record<string, string>;
  // element id to click after filling
  click?: string;
  // size to the content, at most 800x600 (a browser's popup limit), instead of a desktop window
  popup?: boolean;
  // text of a Links table header to click (go/help), to show the table sorted by that column
  sortBy?: string;
  // show the page with no user links at all (the sample links are stored again for the next shot)
  noLinks?: boolean;
  // a window taller than the desktop one, to show a long page whole
  tall?: boolean;
  // the stored appearance choice (none = System), set from --appearance
  appearance?: string;
}

// Options from the command line (see the header).
let DARK = false;
let APPEARANCE: string | undefined;
const suffix = () => (APPEARANCE ? `-${APPEARANCE}` : DARK ? "-dark" : "");

const DESKTOP = { width: 1280, height: 800 };
const TALL = { width: 1280, height: 2800 };
const POPUP_MAX = { width: 800, height: 600 };

// A destination with two go links, plus one other link, and two links that were shipped as defaults
// (the sample replaces the stored links, so they are listed here).
const SEED_LINKS = {
  docs: "https://docs.example.com/",
  wiki: "https://docs.example.com",
  board: "https://team.example.com/board",
  github: "https://github.com",
  cs: "https://github.com/search?q=%s",
};
// Hits to show on go/help: name -> [total count, seconds ago of the last hit].
const SEED_HITS: Record<string, [number, number]> = { docs: [42, 3600], github: [7, 86400 * 3], cs: [1, 45] };
// What the popup would be prefilled with: the active tab's URL.
const SAMPLE_TAB_URL = "https://docs.example.com";

const NAMED: Record<string, Shot> = {
  popup: { label: "popup", src: "popup.html", fill: { "link-url": SAMPLE_TAB_URL }, popup: true },
  "not-found": { label: "not-found", src: "notfound.html?name=zzsample" },
  help: { label: "help", src: "index.html" },
  // go/help with the "Reset to default" confirmation open.
  "help-dialog": { label: "help-dialog", src: "index.html", click: "reset-btn" },
  // go/help in a tall window, to show the whole page (for docs/images/help.png, cropped).
  "help-full": { label: "help-full", src: "index.html", tall: true },
  "help-sorted": { label: "help-sorted", src: "index.html", sortBy: "Hits" },
  overwrite: {
    label: "overwrite",
    src: "popup.html",
    fill: { "link-url": "https://example.com/new", "link-name": "docs" },
    click: "add-btn",
    popup: true,
  },
  // The popup just after a save: the success line, the form locked, a moment before it closes.
  "popup-saved": {
    label: "popup-saved",
    src: "popup.html",
    fill: { "link-name": "wiki2", "link-url": "https://docs.example.com/wiki" },
    click: "add-btn",
    popup: true,
  },
  // The style guide: an extension page that no UI links to (see common/styleguide.html).
  styleguide: { label: "styleguide", src: "styleguide.html", tall: true },
  // go/help states: the form's rows with no user links, a validation error, and the overwrite
  // confirm (board is taken; the URL is the one docs and wiki have, so they are listed too).
  "help-empty": { label: "help-empty", src: "index.html", noLinks: true },
  "help-error": {
    label: "help-error",
    src: "index.html",
    fill: { "link-name": "a b", "link-url": "ftp://example.com" },
    click: "add-btn",
  },
  "help-overwrite": {
    label: "help-overwrite",
    src: "index.html",
    fill: { "link-name": "board", "link-url": SAMPLE_TAB_URL },
    click: "add-btn",
  },
};

function shotFor(page: string): Shot {
  const named = NAMED[page];
  if (named) return named;
  const label = page.replace(/[^\w.-]+/g, "_").replace(/\.html/, "");
  return { label, src: page };
}

// The harnesses are plain JavaScript: loaded at run time, so they need no types.
async function load(rel: string): Promise<any> {
  return import(pathToFileURL(path.join(REPO, rel)).href);
}

function save(browser: string, label: string, png: Buffer): void {
  const dir = path.join(REPO, ".screenshots", browser);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${label}${suffix()}.png`);
  writeFileSync(file, png);
  console.log(file);
}

const fit = (size: { width: number; height: number }) => ({
  width: Math.max(200, Math.min(POPUP_MAX.width, size.width + 16)),
  height: Math.max(100, Math.min(POPUP_MAX.height, size.height + 16)),
});

async function shootFirefox(shots: Shot[]): Promise<void> {
  const { startFirefox } = await load("tests/firefox/lib/fixture.mjs");
  const fx = await startFirefox(DARK ? { "layout.css.prefers-color-scheme.content-override": 0 } : {});
  try {
    const { ff, dir } = fx;
    // The harness page (see tests/firefox/harness/test.js) is the only way to script an
    // extension page in Firefox. It reports back through its URL fragment.
    const run = async (op: string) => {
      await ff.get("about:blank");
      await ff.waitUrl((u: string) => u === "about:blank");
      await ff.get(`https://go/zztest-${op}`);
      const url: string = await ff.waitFor(
        () => ff.currentUrl(),
        (u: string) => u.includes("#result="),
        20_000,
      );
      if (!url.includes("#result=")) throw new Error(`harness op ${op} gave no result, url=${url}`);
      const result = JSON.parse(Buffer.from(url.split("#result=")[1]!, "hex").toString());
      if (!result.ok) throw new Error(`harness op ${op} failed: ${result.error}`);
      return result;
    };
    // Firefox refuses to screenshot a page with extension privileges, so the shot is taken of
    // an ordinary web page on the go host (it resolves to loopback in the harness) that
    // embeds the harness page, which embeds the extension page. Both are web accessible.
    const server = createServer((_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end(`<!doctype html><body style="margin:0"><title>loading</title>
        <iframe id="f" style="border:0;width:100vw;height:100vh;display:block"></iframe>
        <script>
          f.src = new URLSearchParams(location.search).get("src");
          addEventListener("message", (e) => { if (e.data === "frame-ready") document.title = "ready"; });
        </script>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const serverPort = (server.address() as { port: number }).port;
    try {
      const seed = async (localLinks: Record<string, string>) => {
        writeFileSync(path.join(dir, "seed.json"), JSON.stringify({ localLinks, hits: SEED_HITS }));
        await run("seed");
      };
      await seed(SEED_LINKS);
      let empty = false;
      for (const shot of shots) {
        if (!!shot.noLinks !== empty) {
          empty = !!shot.noLinks;
          await seed(empty ? {} : SEED_LINKS);
        }
        writeFileSync(path.join(dir, "shot.json"), JSON.stringify({ ...shot, appearance: APPEARANCE }));
        await ff.setWindowRect(DESKTOP.width, DESKTOP.height);
        // First pass as a top-level page: measures the content and reports its origin.
        const result = await run("frame");
        const origin = (await ff.currentUrl()).split("/test.html")[0];
        const size = shot.popup ? fit(result) : shot.tall ? TALL : DESKTOP;
        await ff.setWindowRect(size.width, size.height);
        await ff.get(`http://go:${serverPort}/?src=${encodeURIComponent(`${origin}/test.html?op=frame`)}`);
        await ff.waitFor(
          () => ff.title(),
          (t: string) => t === "ready",
          10_000,
        );
        if (shot.popup) {
          // The window is larger than its viewport; grow it by the difference.
          const [w, h] = await ff.execute("return [innerWidth, innerHeight]");
          await ff.setWindowRect(size.width + (size.width - w), size.height + (size.height - h));
          await new Promise((r) => setTimeout(r, 200));
        }
        save("firefox", shot.label, await ff.screenshot());
      }
    } finally {
      server.close();
    }
  } finally {
    await fx.stop();
  }
}

async function shootChrome(shots: Shot[]): Promise<void> {
  const { startChrome } = await load("tests/chrome/lib/fixture.mjs");
  const { setLinksExpr } = await load("tests/lib/links.mjs");
  const fx = await startChrome();
  try {
    const { chrome } = fx;
    const page = await chrome.newPage();
    if (DARK)
      await chrome.send(
        "Emulation.setEmulatedMedia",
        { features: [{ name: "prefers-color-scheme", value: "dark" }] },
        page.sessionId,
      );
    const ev = (expr: string) => chrome.evaluate(page, expr);
    const open = async (src: string) => {
      await chrome.navigate(page, `${chrome.origin}/${src}`);
      await chrome.waitUrl(page, (u: string) => u.startsWith(chrome.origin));
      for (
        let i = 0;
        i < 100 && !(await ev(`!!(document.getElementById("add-btn") || document.body?.dataset.ready)`));
        i++
      ) {
        await new Promise((r) => setTimeout(r, 50));
      }
    };
    await open("index.html");
    await ev(setLinksExpr(SEED_LINKS));
    // Wait for the background to record the edits, then add the sample hits to them.
    await ev(`(async () => {
      const get = async () => (await chrome.storage.local.get("linkMetrics")).linkMetrics;
      for (let i = 0; i < 100 && !(await get())?.board?.lastEdit; i++) await new Promise((r) => setTimeout(r, 50));
      const metrics = (await get()) ?? {};
      const now = Math.floor(Date.now() / 1000);
      for (const [name, [count, ago]] of Object.entries(${JSON.stringify(SEED_HITS)})) {
        metrics[name] = { recent: [], hourly: [], daily: [], ...metrics[name], count, lastHit: now - ago };
      }
      await chrome.storage.local.set({ linkMetrics: metrics });
      return true;
    })()`);
    let empty = false;
    for (const shot of shots) {
      if (!!shot.noLinks !== empty) {
        empty = !!shot.noLinks;
        await ev(setLinksExpr(empty ? {} : SEED_LINKS));
        await new Promise((r) => setTimeout(r, 400));
      }
      await chrome.setViewport(page, (shot.tall ? TALL : DESKTOP).width, (shot.tall ? TALL : DESKTOP).height);
      // the remembered sort and appearance are per device
      await ev(
        APPEARANCE
          ? `chrome.storage.local.set({ appearance: ${JSON.stringify(APPEARANCE)} })`
          : `chrome.storage.local.remove("appearance")`,
      );
      await ev(`chrome.storage.local.remove("helpSort")`);
      await open(shot.src);
      await ev(`(() => {
        for (const [id, value] of Object.entries(${JSON.stringify(shot.fill ?? {})})) {
          const el = document.getElementById(id);
          el.value = value;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
        return true;
      })()`);
      if (shot.sortBy)
        await ev(
          `[...document.querySelectorAll("#links th button")].find((b) => b.textContent === ${JSON.stringify(shot.sortBy)}).click(); true`,
        );
      if (shot.click) await ev(`document.getElementById(${JSON.stringify(shot.click)}).click(); true`);
      await new Promise((r) => setTimeout(r, 400));
      if (shot.popup) {
        const size = fit(
          await ev(`(() => {
            const r = [...document.querySelectorAll("body *")].map((e) => e.getBoundingClientRect());
            return { width: Math.ceil(Math.max(...r.map((x) => x.right))), height: Math.ceil(Math.max(...r.map((x) => x.bottom))) };
          })()`),
        );
        await chrome.setViewport(page, size.width, size.height);
        await new Promise((r) => setTimeout(r, 150));
      }
      save("chrome", shot.label, await chrome.screenshot(page));
    }
  } finally {
    await fx.stop();
  }
}

const argv = process.argv.slice(2);
DARK = argv.includes("--dark");
const at = argv.indexOf("--appearance");
if (at >= 0) {
  APPEARANCE = argv[at + 1];
  if (!["light", "dark", "system"].includes(APPEARANCE ?? "")) {
    console.error("--appearance needs light, dark or system");
    process.exit(1);
  }
}
const args = argv.filter((a, i) => a !== "--dark" && a !== "--appearance" && !(at >= 0 && i === at + 1));
if (args.includes("--help") || args.includes("-h")) {
  console.log(
    "usage: pnpm screenshot [firefox|chrome|both] [page ...] [--dark] [--appearance light|dark|system]\npages: popup, not-found, help, help-full, help-sorted, help-full, help-dialog, popup-saved, overwrite, help-empty, help-error, help-overwrite, styleguide, or an extension page path such as notfound.html?name=x\ndefault: both browsers; popup, not-found, help",
  );
  process.exit(0);
}
const browsers = args.filter((a) => ["firefox", "chrome", "both"].includes(a));
const pages = args.filter((a) => !["firefox", "chrome", "both"].includes(a));
const wanted = browsers.length === 0 || browsers.includes("both") ? ["firefox", "chrome"] : browsers;
const shots = (pages.length ? pages : ["popup", "not-found", "help"]).map(shotFor);

for (const browser of wanted) {
  const started = Date.now();
  await (browser === "firefox" ? shootFirefox(shots) : shootChrome(shots));
  console.log(`${browser}: ${((Date.now() - started) / 1000).toFixed(1)} s`);
}
