// pnpm screenshot [firefox|chrome|both] [page ...] [--out <dir>]
//
// Builds the extension, installs it in headless Firefox and/or Chrome (the
// test harnesses in tests/*/lib), stores a few sample links, and saves a PNG
// of each page to .screenshots/<browser>/<page>.png (git-ignored). For checking
// a UI change by eye: it is not a test. Needs the same programs as the browser
// suites (see CLAUDE.md); hold the hive lease "browser-suites" while it runs.
//
// Pages: popup, not-found, help, overwrite (the popup after saving over a taken
// name), or any extension page path with a query string, e.g. "notfound.html?name=x".
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
}

const DESKTOP = { width: 1280, height: 800 };
const POPUP_MAX = { width: 800, height: 600 };

// A destination with two go links, plus one other link; the defaults add more.
const SEED_LINKS = {
  docs: "https://docs.example.com/",
  wiki: "https://docs.example.com",
  board: "https://team.example.com/board",
};
// What the popup would be prefilled with: the active tab's URL.
const SAMPLE_TAB_URL = "https://docs.example.com";

const NAMED: Record<string, Shot> = {
  popup: { label: "popup", src: "popup.html", fill: { "link-url": SAMPLE_TAB_URL }, popup: true },
  "not-found": { label: "not-found", src: "notfound.html?name=zzsample" },
  help: { label: "help", src: "index.html" },
  overwrite: {
    label: "overwrite",
    src: "popup.html",
    fill: { "link-url": "https://example.com/new", "link-name": "docs" },
    click: "add-btn",
    popup: true,
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
  const file = path.join(dir, `${label}.png`);
  writeFileSync(file, png);
  console.log(file);
}

const fit = (size: { width: number; height: number }) => ({
  width: Math.max(200, Math.min(POPUP_MAX.width, size.width + 16)),
  height: Math.max(100, Math.min(POPUP_MAX.height, size.height + 16)),
});

async function shootFirefox(shots: Shot[]): Promise<void> {
  const { startFirefox } = await load("tests/firefox/lib/fixture.mjs");
  const fx = await startFirefox();
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
      writeFileSync(path.join(dir, "seed.json"), JSON.stringify({ localLinks: SEED_LINKS }));
      await run("seed");
      for (const shot of shots) {
        writeFileSync(path.join(dir, "shot.json"), JSON.stringify(shot));
        await ff.setWindowRect(DESKTOP.width, DESKTOP.height);
        // First pass as a top-level page: measures the content and reports its origin.
        const result = await run("frame");
        const origin = (await ff.currentUrl()).split("/test.html")[0];
        const size = shot.popup ? fit(result) : DESKTOP;
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
  const fx = await startChrome();
  try {
    const { chrome } = fx;
    const page = await chrome.newPage();
    const ev = (expr: string) => chrome.evaluate(page, expr);
    const open = async (src: string) => {
      await chrome.navigate(page, `${chrome.origin}/${src}`);
      await chrome.waitUrl(page, (u: string) => u.startsWith(chrome.origin));
      for (let i = 0; i < 100 && !(await ev(`!!document.getElementById("add-btn")`)); i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
    };
    await open("index.html");
    await ev(`chrome.storage.sync.set({ localLinks: ${JSON.stringify(SEED_LINKS)} })`);
    for (const shot of shots) {
      await chrome.setViewport(page, DESKTOP.width, DESKTOP.height);
      await open(shot.src);
      await ev(`(() => {
        for (const [id, value] of Object.entries(${JSON.stringify(shot.fill ?? {})})) {
          const el = document.getElementById(id);
          el.value = value;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
        return true;
      })()`);
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

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(
    "usage: pnpm screenshot [firefox|chrome|both] [page ...]\npages: popup, not-found, help, overwrite, or an extension page path such as notfound.html?name=x\ndefault: both browsers; popup, not-found, help",
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
