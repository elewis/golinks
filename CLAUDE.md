# GoLinks Browser Extensions

## Overview
Browser extensions that provide in-browser go/ links (e.g., `go/github`) that redirect to configured URLs. Available for both Chrome and Firefox with Manifest v3 compatibility.

## Architecture

### Directory Structure
```
golinks/
├── common/          # files both browsers run, byte for byte
├── chrome/          # Chrome-only: manifest.json, background.js
├── firefox/         # Firefox-only: manifest.json, background.js
├── scripts/build.mjs  # copies common/ + <browser>/ into dist/<browser>/
└── dist/            # git-ignored build output: load this, zip this for the stores
```
Build with `pnpm build` (both), `pnpm build:firefox` or `pnpm build:chrome`. The build is a plain copy (Node built-ins only). A file name present in both `common/` and a browser folder is an error, so nothing is overridden silently. Edit `common/`, `chrome/` and `firefox/`, never `dist/`.

### Key Files
- `common/api.js` - namespace shim, loaded first everywhere: `const api = globalThis.browser ?? globalThis.chrome;`. All shared code calls `api.*` (Promise-based MV3 calls, valid in both browsers).
- `common/links.js` - link storage/retrieval from browser sync storage (`getLinks()`, default links)
- `common/rules.js` - rule generation (`get_rule()`, `escapeRegex()`), the serialised `refreshRules()` queue, `startRules()`, and the storage change listener
- `common/index.html`, `common/index.js` - help page for `go/help` and bare `go/`, with the add/delete link form
- `common/notfound.html` - 404 page for unmatched go/ links
- `firefox/search.js` - Firefox-only pure logic: `goUrlFromSearch()`, `recordInterception()`, `MAX_INTERCEPTIONS`
- `chrome/manifest.json`, `firefox/manifest.json` - Manifest v3, `declarativeNetRequestWithHostAccess` and `storage` permissions (Firefox adds `webRequest`)
- `chrome/background.js` - service worker: `importScripts("api.js", "links.js", "rules.js")`, then `startRules()`
- `firefox/background.js` - event page (manifest `scripts` lists `api.js`, `links.js`, `rules.js`, `search.js`, `background.js`): host-permission warning, `startRules()`, webRequest interception and interception recording

### How It Works
1. **Initialization**: Background script loads links from browser storage, creates redirect rules
2. **Storage Integration**: Uses browser sync storage for configurable links that sync across devices  
3. **Dynamic Updates**: Storage change listener automatically updates rules when links are modified
4. **Rule Generation**: Single `get_rule()` function (in `common/rules.js`) handles both parameterized (`%s`) and static redirects
5. **Protocol Handling**: Firefox uses webRequest to catch bare `go/` URLs from address bar searches

### Link Types
- **Static**: `"github": "https://github.com"` → `go/github` redirects to GitHub. Matches the exact name only (regexFilter `^https?://go/<name>$`, name escaped), so `*`, `^`, `|`, `.` in a name are literal and `go/githubx` does not match.
- **Parameterized**: `"githubsearch": "https://github.com/search?q=%s"` → `go/githubsearch/query` passes `query` as parameter. regexFilter `^https?://go/<name>(?:/(.*))?$`: the parameter is everything after `go/<name>/` (`go/cs/a/b` passes `a/b`), bare `go/cs` passes an empty one, and `go/csx` does not match the `cs` rule.

## Browser-Specific Implementation

### Chrome Version (`chrome/`)
- Shared code uses `api.*` (resolves to `chrome.*`); `chrome/background.js` is only the worker entry point
- Service worker background script with `importScripts()`
- Requires `https://go/github` format in address bar

### Firefox Version (`firefox/`)
- Shared code uses `api.*` (the shim in `common/api.js`); `firefox/background.js` does too (no polyfill needed)
- Event page background script with manifest `scripts` array
- Includes a `webRequest` listener to catch bare `go/github` from address bar searches. Firefox turns that text into a search on the default engine, and an extension cannot change that (no API sets `browser.fixup.*`, experiments are off on Release), so the listener is the mechanism. It watches main_frame requests on every host (`<all_urls>`, `*://*/*` in `host_permissions`), so regional and custom engines work. It redirects to `https://go/...` only when the query parameter (`q`, `p`, `query` or `text`) starts with `go/` followed by a link name, and only when the request has no `details.originUrl`. An address-bar navigation has none; a link click or form submit from a page does, so those are left alone. Pages with an opaque origin (`data:`) report no originUrl and would still be redirected.
- Every interception is recorded in `browser.storage.local` (per device, not sync) under `interceptions`: an array, newest last, capped at the last 100 (`MAX_INTERCEPTIONS`). Entry: `{ at: ISO timestamp, from: the original search URL, to: the https://go/... URL, tabId }`. `recordInterception(details, redirectUrl)` in `search.js` writes it, serialised on a promise chain and not awaited by the listener. Recording only; no UI yet. Needs no extra permission.
- Hybrid approach: webRequest for protocol-less URLs, declarativeNetRequest for actual redirects

## Chrome/Firefox Parity
Shared code lives once, in `common/`, so it cannot drift. There is no diff-based check any more.

- **Shared**: `api.js`, `links.js`, `rules.js`, `index.js`, `index.html`, `notfound.html`. Use `api.*`, never `browser.*` or `chrome.*`, in `common/`.
- **Allowed divergence**: only the two `background.js` files, the two `manifest.json` files and Firefox's `search.js` (its address-bar search logic), and only for browser-specific needs: the service worker with `importScripts()` vs the event page with a manifest `scripts` array, Firefox's `webRequest` interception of protocol-less `go/` URLs and its recording, and browser-specific manifest keys. Anything both browsers do (rule generation, storage handling) goes in `common/`, not in a background file.
- **Bug fixes**: a fix in `common/` fixes both. A fix in a browser folder: check whether the other browser has the same problem and fix both in the same change, or file a follow-up todo and say so in the commit body.
- **New behavior**: features land in both extensions together. A feature limited to one browser lives in that browser's folder, and the commit body and this file say why.
- **New file**: a name must not exist in both `common/` and a browser folder (the build fails).

## Recent Fixes & Improvements
- **Added Firefox support** with cross-browser compatibility
- **Fixed CSP violations** that broke the extension in modern Chrome
- **Eliminated code duplication** by consolidating rule generation logic  
- **Made links configurable** without extension reload via browser storage API
- **Added proper error handling** and minimal production logging
- **Solved protocol-less URL problem** in Firefox using webRequest interception

## Development Notes
- **Chrome**: Uses service workers with `importScripts()` 
- **Firefox**: Uses event pages with manifest `scripts` array
- **No dependencies**: Direct browser API usage, no polyfill libraries
- Rules are dynamically managed via `declarativeNetRequest` 
- Storage changes trigger automatic rule updates without restart
- Extensions initialize with default links if storage is empty
- Firefox webRequest intercepts search queries to handle `go/github` typed directly in address bar

## Testing

### Test workflow
Red/green with `pnpm test` only: it is fast (under a second, no browser, no network), so run it after every change. Run `pnpm test:full` once at the end, before a handback, commit or merge. Do not iterate on the browser suites.

```
pnpm test        # build tests + extension unit tests + loader unit tests
pnpm test:full   # pnpm test, then test:firefox, test:chrome, test:loader:integration
```
`pnpm test:unit` runs only the extension unit tests and `pnpm test:loader` only the loader unit tests (rdp framing, profiles, prefs). `pnpm test:loader:integration` runs the loader's headless-Firefox test.

### Unit tests
`tests/unit/*.test.mjs` run the shipped classic scripts (`common/*.js`, `firefox/search.js`, `firefox/background.js`) unchanged in a `node:vm` context with a fake `browser` (in-memory `storage.sync`/`storage.local`, `declarativeNetRequest` that rejects duplicate rule ids, recorded listeners), see `tests/unit/lib/sandbox.mjs`. Top-level `const`/`let` are not properties of the context, so tests read them with `get("expr")`. Covers regex escaping, `%s` vs static rules (end anchors, `go/csx` vs `cs`, parameter `a/b`, `*`/`|` literal in static names), rule ids and the help/root/not-found rules, default and local links, the serialised `refreshRules()` queue (no interleaving, a failure does not block), the storage listener, `goUrlFromSearch` (any host, `q`/`p`/`query`/`text`, non-matches), the interception record shape and cap, and the Firefox listener (no `originUrl` only). A new script that a background loads must be added to the load list in the test.

### Chrome
Run `pnpm build:chrome`, then load `dist/chrome` as an unpacked extension. Navigate to `https://go/github`, `https://go/cs/test`, or `https://go/help`. Check service worker console at `chrome://extensions/`.

### Firefox  
Run `pnpm build:firefox`, then load `dist/firefox` (or `pnpm load:firefox`, which builds first). Navigate to `go/github` (protocol-less works!), `https://go/cs/test`, or `https://go/help`. Check extension console at `about:debugging`.

### Build tests
```
pnpm test:build
```
Fast (no browser; `pnpm test` runs it too): the build output holds `common/` and the browser folder byte for byte, a name clash is an error, every script a manifest, worker or page loads exists in the build, and `pnpm load:firefox` rebuilds `dist/firefox`. 

### Firefox automated tests
```
pnpm test:firefox
```
Builds `common/` + `firefox/` into a throwaway copy and installs it as a temporary add-on in headless Firefox and exits non-zero on any failure. No dependencies are installed: it uses Node 24 (`node:test`, built-in `fetch`) and raw WebDriver against the system geckodriver.

**Prerequisites**: Node 24, pnpm, snap Firefox and `/snap/bin/geckodriver`. The copy is built in `tests/firefox/.build/` (git-ignored, deleted after the run) because snap-confined Firefox cannot read `/tmp`.

**Covers**: the background page loads with no JavaScript errors (startup errors fail the run); `go/github`, `go/cs/test`, `http://go/gh`, `go/help`, `go/` and an unknown link; adding and deleting a link through the options form updates the redirect rules; a burst of overlapping storage writes never fails with "Duplicate rule ID" and leaves the rules for the last write; link names containing regex characters (`a.b`, `c++`) match literally; `go/csx` does not match the `cs` rule. URLs that merely contain `go/` (`https://github.com/golang/go/issues`, `https://foo.go/bar`, `?q=ago/github`, `?other=go/github`) are not redirected; a navigation with no origin to a URL carrying `go/github` in `q`, `p`, `query` or `text` on any host (what the address bar produces: google.com, google.co.uk, a custom engine) is; a link click or GET form submit from an http page to such a URL is not. Interceptions are recorded in `storage.local.interceptions` with the right `from`/`to`, a non-intercepted URL adds none, and 150 overlapping records keep only the last 100 in order.

**Does not cover**: typing protocol-less `go/github` in the real address bar (WebDriver cannot drive it, so only the webRequest listener is exercised; WebDriver navigation stands in for typing, as neither has an originUrl), clicks from `data:` pages, the about:debugging UI, signed or permanent installs, Firefox Sync, private windows, Chrome.

Set `GOLINKS_MUTATE=<name>` (names in `tests/firefox/lib/extension.mjs`; each names the built file it edits, e.g. `rules.js` or `background.js`) to break the copy on purpose and check that a test goes red.

### Chrome automated tests
```
pnpm test:chrome
```
Builds `common/` + `chrome/` into a throwaway copy and installs it in headless Google Chrome and exits non-zero on any failure. `pnpm test:full` runs this suite after the Firefox one. No dependencies are installed: it uses Node 24 (`node:test`, built-in `fetch` and `WebSocket`) and talks to Chrome directly over the DevTools protocol, with no chromedriver.

**Prerequisites**: Node 24, pnpm and `/usr/bin/google-chrome`. The copy is built in `tests/chrome/.build/` (git-ignored, deleted after the run).

**Launch flags**: `--headless=new --no-sandbox --no-first-run --disable-gpu --enable-unsafe-extension-debugging --remote-debugging-port=<free port> --user-data-dir=<temp> --host-resolver-rules="MAP go 127.0.0.1"`. Branded Chrome ignores `--load-extension`, so the extension is installed with the DevTools method `Extensions.loadUnpacked`, which needs `--enable-unsafe-extension-debugging`. Chrome has no equivalent of Firefox's `network.dns.localDomains`, so `--host-resolver-rules` makes the `go` host resolve. Every Chrome process group started is killed on exit, Ctrl-C or SIGTERM.

**Covers**: the service worker starts with no JavaScript errors (its console is captured from the first line); `https://go/github`, `https://go/cs/test`, `http://go/gh`, `https://go/help`, `https://go/` and an unknown link; adding and deleting a link through the options form updates the redirect rules; a burst of overlapping storage writes never fails and leaves the rules for the last write; link names containing regex characters (`a.b`, `c++`) match literally; `go/csx` does not match the `cs` rule; `https://github.com/golang/go/issues` is not redirected. Pages never touch the internet: requests that survive the extension's redirects are answered with an empty 200.

**Does not cover**: typing `go/github` in the real address bar (Chrome treats it as a search; DevTools cannot drive the omnibox), `chrome://extensions`, packed or Web Store installs, Chrome Sync, incognito, Firefox.

Set `GOLINKS_MUTATE=<name>` (names in `tests/chrome/lib/extension.mjs`) to break the copy on purpose and check that a test goes red.

### Dev loader (Firefox)
```
pnpm load:firefox
```
Builds `dist/firefox/` (`common/` + `firefox/`) and installs it as a temporary add-on into your everyday Firefox, replacing the about:debugging "Load Temporary Add-on" clicks. Run it again after an edit to rebuild and reload the add-on. It talks to Firefox's Remote Debugging Protocol (what `web-ext run` uses) with `node:net` only. It does not use WebDriver/Marionette, so Firefox is not marked as automated. No dependencies. Firefox is run from `/snap/bin/firefox` (the `/usr/bin/firefox` wrapper changes desktop settings), and the add-on is installed from `dist/firefox/`, rebuilt on every run (an explicit `--addon <dir>` is installed as it is).

**Why the server is closed again**: Firefox puts its window in "remote controlled" mode (striped URL bar, robot icon, `remotecontrol` attribute on the window) for as long as a DevTools socket listens (`gRemoteControl` in `browser.js`, fed by `DevToolsSocketStatus`). `--start-debugger-server` opens such a socket, so the old loader, which left it open, left Firefox in that state. Now the server is open only for the install: the script installs the add-on, then closes the listening socket from Firefox's parent process (`DevToolsServer.closeAllSocketListeners()`, on the same server object `DevToolsStartup` made). The window loses the cue at once and nothing listens on the port. The script closes every DevTools listener in that server, not only the one on `--port`, so a server left open by the old loader or by hand is closed too (the aim is a browser that is never left remote controlled; do not use this loader alongside other debugger clients). The installed temporary add-on stays until Firefox restarts. The close relies on Firefox internals (`DistinctSystemPrincipalLoader.sys.mjs` and the `@mozilla.org/devtools/startup-clh;1` component), verified on Firefox 157 only; if a Firefox update moves them the script exits non-zero naming them and the window stays remote controlled until it restarts. This was checked against Firefox 157's own source (`omni.ja`) and by reading the attribute over the protocol before and after.

**What it does, in order**:
1. Something already speaks the debugger protocol on the port: installs or reloads the add-on, closes the server and exits. No restart.
2. Firefox is running on the profile without the server and can take a forwarded command (it was not started with `--no-remote` or `--headless`; checked from `/proc/<pid>/cmdline`): runs `firefox --profile <dir> --start-debugger-server <port>`, which Firefox forwards to the running instance (no restart, same pid; the script checks the pid did not change), then installs and closes the server as above. This is the normal edit-reload loop, and it works because an earlier run left the debugger prefs in force for that session (see Prefs). If the prefs are not in force there (you started that Firefox yourself) the server does not open; the script then falls back to step 3, and a stray extra window may open once.
3. Otherwise: asks `y/N` (or pass `--restart`), quits it with SIGTERM (a normal shutdown, never SIGKILL) and relaunches it with `--start-debugger-server`. A Firefox started with `--no-remote` (as the first version of this script did) is never sent a second `firefox` command, which would only open a "Firefox is already running" window. If Firefox does not quit within 60 s the script gives up. The tabs only come back by themselves when `browser.startup.page` is 3; otherwise use History > Restore Previous Session (the script warns).
4. Firefox is not running: launches it (normal window, without `--no-remote`, so other programs can still open links in it and step 2 works next time) with the server, then installs and closes the server.

**Prefs (temporary)**: the server needs `devtools.debugger.remote-enabled=true`, `devtools.debugger.prompt-connection=false` and `devtools.chrome.enabled=true`. They are never left in the profile. On a launch the script prints them and asks `y/N` (or pass `--set-prefs`), appends them to the profile's `user.js` (printing the exact lines), starts Firefox, and as soon as it answers removes exactly those lines again (deleting `user.js` if it created it and nothing else is in it) and, in Firefox's parent process, moves the values from the user branch to the default branch (`clearUserPref` plus `getDefaultBranch("").setBoolPref`). Default-branch values apply for the session but are never written to `prefs.js`, so after Firefox quits neither `user.js` nor `prefs.js` mentions them, and the next launch asks again. Within the session they stay in force, which is what lets step 2 reopen the server without a restart. If the script is interrupted (Ctrl-C) it removes its lines first. Prefs the profile already has set the wanted way (by you, or by an old version of this script, which saved them for good) are left alone and reported; the script prints how to remove them but never edits them. A pref the profile sets to the opposite value is an error, not overridden. Firefox's own save about 0.75 s after startup writes the user.js values into `prefs.js`, and the save that drops them after the move is debounced (about 500 ms) and skipped when Firefox gets SIGTERM in that time (measured: 7 of 8 immediate quits kept all three prefs). So the move script ends with `await Services.prefs.savePrefFile(null)`, and `prefs.js` is clean when the loader returns. Left open: a crash or SIGKILL of Firefox in the roughly 0.5 s between that startup save and the move (the loader's own launch) still leaves the three prefs in `prefs.js`; they would show up as "already set" on the next run. Verified on Firefox 157: with default-branch-only prefs a forwarded `--start-debugger-server` opened the server (same pid), and `prefs.js` had none of the three after a clean quit. A crash or SIGKILL before the lines are removed leaves them in `user.js`.

**Risk**: while the server is open, which is only for the few seconds of the install, any program on this computer (localhost only) can connect to the port, with no prompt, and fully control the browser. If the script cannot close the server it exits non-zero and says Firefox stays remote controlled until it is restarted. A temporary add-on is gone when Firefox restarts, so run the script again after each restart (the prefs go with it).

**Options** (`pnpm load:firefox -- --help`): `--profile <dir>` / `GOLINKS_FF_PROFILE` (default: the default profile from `~/snap/firefox/common/.mozilla/firefox/profiles.ini`, else `~/.mozilla/firefox/profiles.ini`), `--port <n>` / `GOLINKS_FF_PORT` (default 6005), `--addon <dir>` (default: build and use `dist/firefox`), `--binary <path>` / `GOLINKS_FF_BIN`, `--set-prefs`, `--restart`, `--headless`.

**Errors**: no profile (lists where it looked), port held by something that is not Firefox's debugger, Firefox's own message when the install is rejected, Firefox refusing to quit, and the server not closing afterwards.

**Tests**: `pnpm test:loader` is the fast unit tests for the protocol framing, profile lookup and prefs (part of `pnpm test`). `pnpm test:loader:integration` (about 40 s; part of `pnpm test:full`) is an integration test that starts headless Firefox on a throwaway profile in `tests/load-firefox/.build/` (git-ignored). It checks that the add-on's background page really runs (the test add-on calls a local HTTP server), that the debugger port is closed after every run, that a reload does not restart Firefox (same pid), that the fallback to the restart prompt is quick when the forwarded command is not taken, that the window's `remotecontrol` attribute (logged from inside Firefox) goes from `true` to `null`, that `user.js` and `prefs.js` hold none of the three prefs while Firefox runs and after it quits, and the refuse/`--restart` paths. It never reads or touches a real profile. **Does not cover**: the real profile, a non-headless window in the suite (headless Firefox has no remoting, so step 2 is only exercised as "skipped, ask to restart"; its success side, including the default-branch prefs, was run by hand in a throwaway headful profile), the visual look of the URL bar, session restore of real tabs.

## Configuration
Links can be updated programmatically in both browsers:

### Chrome
```javascript
chrome.storage.sync.set({
  links: {
    "github": "https://github.com",
    "newlink": "https://example.com"
  }
});
```

### Firefox
```javascript
browser.storage.sync.set({
  links: {
    "github": "https://github.com", 
    "newlink": "https://example.com"
  }
});
```