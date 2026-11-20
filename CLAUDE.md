# GoLinks Browser Extensions

## Overview
Browser extensions that provide in-browser go/ links (e.g., `go/github`) that redirect to configured URLs. Available for both Chrome and Firefox with Manifest v3 compatibility.

## Architecture

### Directory Structure
```
golinks/
├── chrome/          # Chrome extension (Manifest V3)
├── firefox/         # Firefox extension (cross-compatible)
└── shared/          # (future: shared components)
```

### Key Files
- `manifest.json` - Extension configuration with Manifest v3, requires `declarativeNetRequestWithHostAccess` and `storage` permissions
- `background.js` - Manages redirect rules using declarativeNetRequest API (Chrome: service worker, Firefox: event page)
- `links.js` - Handles link storage/retrieval from browser sync storage
- `index.html` - Help page shown for `go/help` and bare `go/` URLs
- `notfound.html` - 404 page for unmatched go/ links

### How It Works
1. **Initialization**: Background script loads links from browser storage, creates redirect rules
2. **Storage Integration**: Uses browser sync storage for configurable links that sync across devices  
3. **Dynamic Updates**: Storage change listener automatically updates rules when links are modified
4. **Rule Generation**: Single `get_rule()` function handles both parameterized (`%s`) and static redirects
5. **Protocol Handling**: Firefox uses webRequest to catch bare `go/` URLs from address bar searches

### Link Types
- **Static**: `"github": "https://github.com"` → `go/github` redirects to GitHub
- **Parameterized**: `"githubsearch": "https://github.com/search?q=%s"` → `go/githubsearch/query` passes `query` as parameter

## Browser-Specific Implementation

### Chrome Version (`chrome/`)
- Uses `chrome.*` APIs directly
- Service worker background script with `importScripts()`
- Requires `https://go/github` format in address bar

### Firefox Version (`firefox/`)
- Uses `browser.*` APIs directly (no polyfill needed)
- Event page background script with manifest `scripts` array
- Includes `webRequest` listener to catch bare `go/github` from address bar searches
- Hybrid approach: webRequest for protocol-less URLs, declarativeNetRequest for actual redirects

## Chrome/Firefox Parity
`chrome/` and `firefox/` are parallel copies of one extension, and they must not drift apart.

- **Mirrored files**: `links.js`, `index.js`, `index.html` and `notfound.html` are identical apart from the API namespace (`chrome.*` vs `browser.*`). Any change to one must be made to the other in the same change. Check with:
  `for f in links.js index.js index.html notfound.html; do diff <(sed 's/browser\./chrome./g' firefox/$f) chrome/$f; done` (no output means in parity).
- **Allowed divergence**: only `background.js` and `manifest.json` may differ, and only for browser-specific needs. These are the service worker with `importScripts()` vs the event page with a manifest `scripts` array, Firefox's `webRequest` interception of protocol-less `go/` URLs, and browser-specific manifest keys. Shared logic in those files, such as rule generation and storage handling, must still behave the same in both.
- **Bug fixes**: when fixing a bug in one browser, check whether the other has it too. Fix both in the same change, or file a follow-up todo for the other browser and say so in the commit body.
- **New behavior**: features land in both extensions together. A feature limited to one browser must say why in the commit body and in this file.

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

### Chrome
Navigate to `https://go/github`, `https://go/cs/test`, or `https://go/help`. Check service worker console at `chrome://extensions/`.

### Firefox  
Navigate to `go/github` (protocol-less works!), `https://go/cs/test`, or `https://go/help`. Check extension console at `about:debugging`.

### Firefox automated tests
```
pnpm test
```
Installs a throwaway copy of `firefox/` as a temporary add-on in headless Firefox and exits non-zero on any failure. No dependencies are installed: it uses Node 24 (`node:test`, built-in `fetch`) and raw WebDriver against the system geckodriver. `pnpm test` is an alias for `pnpm test:firefox`.

**Prerequisites**: Node 24, pnpm, snap Firefox and `/snap/bin/geckodriver`. The copy is built in `tests/firefox/.build/` (git-ignored, deleted after the run) because snap-confined Firefox cannot read `/tmp`.

**Covers**: the background page loads with no JavaScript errors (the known "Duplicate rule ID" startup race is only reported as a warning); `go/github`, `go/cs/test`, `http://go/gh`, `go/help`, `go/` and an unknown link; adding and deleting a link through the options form updates the redirect rules. The known webRequest bug (the listener redirects any URL containing `go/`, so `https://github.com/golang/go/issues` is hijacked) is an expected failure shown as a `todo` test; the run prints an `UNEXPECTED PASS` message when it is fixed, and the `todo` option should then be removed.

**Does not cover**: typing protocol-less `go/github` in the real address bar (WebDriver cannot drive it, so only the webRequest listener is exercised), the about:debugging UI, signed or permanent installs, Firefox Sync, private windows, Chrome.

Set `GOLINKS_MUTATE=<name>` (names in `tests/firefox/lib/extension.mjs`) to break the copy on purpose and check that a test goes red.

### Chrome automated tests
```
pnpm test:chrome
```
Installs a throwaway copy of `chrome/` in headless Google Chrome and exits non-zero on any failure. `pnpm test` runs this suite after the Firefox one. No dependencies are installed: it uses Node 24 (`node:test`, built-in `fetch` and `WebSocket`) and talks to Chrome directly over the DevTools protocol, with no chromedriver.

**Prerequisites**: Node 24, pnpm and `/usr/bin/google-chrome`. The copy is built in `tests/chrome/.build/` (git-ignored, deleted after the run).

**Launch flags**: `--headless=new --no-sandbox --no-first-run --disable-gpu --enable-unsafe-extension-debugging --remote-debugging-port=<free port> --user-data-dir=<temp> --host-resolver-rules="MAP go 127.0.0.1"`. Branded Chrome ignores `--load-extension`, so the extension is installed with the DevTools method `Extensions.loadUnpacked`, which needs `--enable-unsafe-extension-debugging`. Chrome has no equivalent of Firefox's `network.dns.localDomains`, so `--host-resolver-rules` makes the `go` host resolve. Every Chrome process group started is killed on exit, Ctrl-C or SIGTERM.

**Covers**: the service worker starts with no JavaScript errors (its console is captured from the first line; the "Duplicate rule ID" startup race is only reported as a warning, and has not been seen in Chrome); `https://go/github`, `https://go/cs/test`, `http://go/gh`, `https://go/help`, `https://go/` and an unknown link; adding and deleting a link through the options form updates the redirect rules; `https://github.com/golang/go/issues` is not redirected. Pages never touch the internet: requests that survive the extension's redirects are answered with an empty 200.

**Does not cover**: typing `go/github` in the real address bar (Chrome treats it as a search; DevTools cannot drive the omnibox), `chrome://extensions`, packed or Web Store installs, Chrome Sync, incognito, Firefox.

Set `GOLINKS_MUTATE=<name>` (names in `tests/chrome/lib/extension.mjs`) to break the copy on purpose and check that a test goes red.

### Dev loader (Firefox)
```
pnpm load:firefox
```
Installs `firefox/` as a temporary add-on into your everyday Firefox, replacing the about:debugging "Load Temporary Add-on" clicks. Run it again after an edit to reload the add-on. It talks to Firefox's Remote Debugging Protocol (what `web-ext run` uses) with `node:net` only. It does not use WebDriver/Marionette, so Firefox is not marked as automated. No dependencies. Firefox is run from `/snap/bin/firefox` (the `/usr/bin/firefox` wrapper changes desktop settings), and the add-on is installed straight from `firefox/`.

**What it does, in order**:
1. Something already speaks the debugger protocol on the port: installs or reloads the add-on and exits. No restart. This is the normal loop.
2. Firefox is running on the profile without the server: asks `y/N` (or pass `--restart`), quits it with SIGTERM (a normal shutdown, never SIGKILL) and relaunches it with `--start-debugger-server`. If Firefox does not quit within 60 s the script gives up. The tabs only come back by themselves when `browser.startup.page` is 3; otherwise use History > Restore Previous Session (the script warns).
3. Firefox is not running: launches it (normal window) with the server, then installs.

**Prefs**: the server needs `devtools.debugger.remote-enabled=true`, `devtools.debugger.prompt-connection=false` and `devtools.chrome.enabled=true` in the profile. If they are missing the script prints them and asks `y/N` (or pass `--set-prefs`), appends them to the profile's `user.js` and prints the exact lines it wrote. It changes nothing else, and with no terminal and no flag it changes nothing at all. `user.js` is applied on every start, so the prefs stay until you delete those lines.

**Risk**: while Firefox runs with the server, any program on this computer (localhost only) can connect to the port, with no prompt, and fully control the browser. Removing the prefs is not enough, since the server stays open until Firefox restarts; there is no protocol command or pref change that closes it (setting the pref to `false` at runtime did not). A temporary add-on is gone when Firefox restarts, so run the script again after each restart. Without `--start-debugger-server` on the command line and the prefs, a normal Firefox start opens no port.

**Options** (`pnpm load:firefox -- --help`): `--profile <dir>` / `GOLINKS_FF_PROFILE` (default: the default profile from `~/snap/firefox/common/.mozilla/firefox/profiles.ini`, else `~/.mozilla/firefox/profiles.ini`), `--port <n>` / `GOLINKS_FF_PORT` (default 6005), `--addon <dir>`, `--binary <path>` / `GOLINKS_FF_BIN`, `--set-prefs`, `--restart`, `--headless`.

**Errors**: no profile (lists where it looked), port held by something that is not Firefox's debugger, Firefox's own message when the install is rejected, and Firefox refusing to quit.

**Tests**: `pnpm test:loader` (about 5 s; `pnpm test` runs it after the Firefox and Chrome suites): unit tests for the protocol framing, profile lookup and prefs, and an integration test that starts headless Firefox on a throwaway profile in `tests/load-firefox/.build/` (git-ignored), runs the loader, reruns it to prove the reload happens in the same process, and covers the refuse/`--restart` paths. It never reads or touches a real profile. **Does not cover**: the real profile, a non-headless window, session restore of real tabs, that the add-on's background page actually runs (only that Firefox lists it as a temporary add-on, and that edited files are picked up on rerun).

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