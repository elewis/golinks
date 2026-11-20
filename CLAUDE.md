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
- Includes `webRequest` listener to catch bare `go/github` from address bar searches. Firefox turns that text into a search on the default engine, so the listener only fires for a fixed list of search-engine hosts (`SEARCH_ENGINES` in `background.js`, mirrored in `host_permissions`) and only when the query parameter (`q`, `p`, `query` or `text`) starts with `go/`. Other engines are not supported; add them to both places.
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

**Covers**: the background page loads with no JavaScript errors (startup errors fail the run); `go/github`, `go/cs/test`, `http://go/gh`, `go/help`, `go/` and an unknown link; adding and deleting a link through the options form updates the redirect rules; a burst of overlapping storage writes never fails with "Duplicate rule ID" and leaves the rules for the last write; link names containing regex characters (`a.b`, `c++`) match literally. URLs that merely contain `go/` (`https://github.com/golang/go/issues`, `https://example.com/?q=go/x`, `https://foo.go/bar`) are not redirected, and a search-engine URL carrying `go/github` in its query (what the address bar produces) is.

**Does not cover**: typing protocol-less `go/github` in the real address bar (WebDriver cannot drive it, so only the webRequest listener is exercised), the about:debugging UI, signed or permanent installs, Firefox Sync, private windows, Chrome.

Set `GOLINKS_MUTATE=<name>` (names in `tests/firefox/lib/extension.mjs`) to break the copy on purpose and check that a test goes red.

### Chrome automated tests
```
pnpm test:chrome
```
Installs a throwaway copy of `chrome/` in headless Google Chrome and exits non-zero on any failure. `pnpm test` runs this suite after the Firefox one. No dependencies are installed: it uses Node 24 (`node:test`, built-in `fetch` and `WebSocket`) and talks to Chrome directly over the DevTools protocol, with no chromedriver.

**Prerequisites**: Node 24, pnpm and `/usr/bin/google-chrome`. The copy is built in `tests/chrome/.build/` (git-ignored, deleted after the run).

**Launch flags**: `--headless=new --no-sandbox --no-first-run --disable-gpu --enable-unsafe-extension-debugging --remote-debugging-port=<free port> --user-data-dir=<temp> --host-resolver-rules="MAP go 127.0.0.1"`. Branded Chrome ignores `--load-extension`, so the extension is installed with the DevTools method `Extensions.loadUnpacked`, which needs `--enable-unsafe-extension-debugging`. Chrome has no equivalent of Firefox's `network.dns.localDomains`, so `--host-resolver-rules` makes the `go` host resolve. Every Chrome process group started is killed on exit, Ctrl-C or SIGTERM.

**Covers**: the service worker starts with no JavaScript errors (its console is captured from the first line); `https://go/github`, `https://go/cs/test`, `http://go/gh`, `https://go/help`, `https://go/` and an unknown link; adding and deleting a link through the options form updates the redirect rules; a burst of overlapping storage writes never fails and leaves the rules for the last write; link names containing regex characters (`a.b`, `c++`) match literally; `https://github.com/golang/go/issues` is not redirected. Pages never touch the internet: requests that survive the extension's redirects are answered with an empty 200.

**Does not cover**: typing `go/github` in the real address bar (Chrome treats it as a search; DevTools cannot drive the omnibox), `chrome://extensions`, packed or Web Store installs, Chrome Sync, incognito, Firefox.

Set `GOLINKS_MUTATE=<name>` (names in `tests/chrome/lib/extension.mjs`) to break the copy on purpose and check that a test goes red.

### Dev loader (Firefox)
```
pnpm load:firefox
```
Installs `firefox/` as a temporary add-on into your everyday Firefox, replacing the about:debugging "Load Temporary Add-on" clicks. Run it again after an edit to reload the add-on. It talks to Firefox's Remote Debugging Protocol (what `web-ext run` uses) with `node:net` only. It does not use WebDriver/Marionette, so Firefox is not marked as automated. No dependencies. Firefox is run from `/snap/bin/firefox` (the `/usr/bin/firefox` wrapper changes desktop settings), and the add-on is installed straight from `firefox/`.

**Why the server is closed again**: Firefox puts its window in "remote controlled" mode (striped URL bar, robot icon, `remotecontrol` attribute on the window) for as long as a DevTools socket listens (`gRemoteControl` in `browser.js`, fed by `DevToolsSocketStatus`). `--start-debugger-server` opens such a socket, so the old loader, which left it open, left Firefox in that state. Now the server is open only for the install: the script installs the add-on, then closes the listening socket from Firefox's parent process (`DevToolsServer.closeAllSocketListeners()`, on the same server object `DevToolsStartup` made). The window loses the cue at once and nothing listens on the port. The script closes every DevTools listener in that server, not only the one on `--port`, so a server left open by the old loader or by hand is closed too (the aim is a browser that is never left remote controlled; do not use this loader alongside other debugger clients). The installed temporary add-on stays until Firefox restarts. The close relies on Firefox internals (`DistinctSystemPrincipalLoader.sys.mjs` and the `@mozilla.org/devtools/startup-clh;1` component), verified on Firefox 157 only; if a Firefox update moves them the script exits non-zero naming them and the window stays remote controlled until it restarts. This was checked against Firefox 157's own source (`omni.ja`) and by reading the attribute over the protocol before and after.

**What it does, in order**:
1. Something already speaks the debugger protocol on the port: installs or reloads the add-on, closes the server and exits. No restart.
2. Firefox is running on the profile without the server and can take a forwarded command (it was not started with `--no-remote` or `--headless`; checked from `/proc/<pid>/cmdline`): runs `firefox --profile <dir> --start-debugger-server <port>`, which Firefox forwards to the running instance (no restart, same pid; the script checks the pid did not change), then installs and closes the server as above. This is the normal edit-reload loop, and it works because an earlier run left the debugger prefs in force for that session (see Prefs). If the prefs are not in force there (you started that Firefox yourself) the server does not open; the script then falls back to step 3, and a stray extra window may open once.
3. Otherwise: asks `y/N` (or pass `--restart`), quits it with SIGTERM (a normal shutdown, never SIGKILL) and relaunches it with `--start-debugger-server`. A Firefox started with `--no-remote` (as the first version of this script did) is never sent a second `firefox` command, which would only open a "Firefox is already running" window. If Firefox does not quit within 60 s the script gives up. The tabs only come back by themselves when `browser.startup.page` is 3; otherwise use History > Restore Previous Session (the script warns).
4. Firefox is not running: launches it (normal window, without `--no-remote`, so other programs can still open links in it and step 2 works next time) with the server, then installs and closes the server.

**Prefs (temporary)**: the server needs `devtools.debugger.remote-enabled=true`, `devtools.debugger.prompt-connection=false` and `devtools.chrome.enabled=true`. They are never left in the profile. On a launch the script prints them and asks `y/N` (or pass `--set-prefs`), appends them to the profile's `user.js` (printing the exact lines), starts Firefox, and as soon as it answers removes exactly those lines again (deleting `user.js` if it created it and nothing else is in it) and, in Firefox's parent process, moves the values from the user branch to the default branch (`clearUserPref` plus `getDefaultBranch("").setBoolPref`). Default-branch values apply for the session but are never written to `prefs.js`, so after Firefox quits neither `user.js` nor `prefs.js` mentions them, and the next launch asks again. Within the session they stay in force, which is what lets step 2 reopen the server without a restart. If the script is interrupted (Ctrl-C) it removes its lines first. Prefs the profile already has set the wanted way (by you, or by an old version of this script, which saved them for good) are left alone and reported; the script prints how to remove them but never edits them. A pref the profile sets to the opposite value is an error, not overridden. Verified on Firefox 157: with default-branch-only prefs a forwarded `--start-debugger-server` opened the server (same pid), and `prefs.js` had none of the three after a clean quit. A crash or SIGKILL before the lines are removed leaves them in `user.js`.

**Risk**: while the server is open, which is only for the few seconds of the install, any program on this computer (localhost only) can connect to the port, with no prompt, and fully control the browser. If the script cannot close the server it exits non-zero and says Firefox stays remote controlled until it is restarted. A temporary add-on is gone when Firefox restarts, so run the script again after each restart (the prefs go with it).

**Options** (`pnpm load:firefox -- --help`): `--profile <dir>` / `GOLINKS_FF_PROFILE` (default: the default profile from `~/snap/firefox/common/.mozilla/firefox/profiles.ini`, else `~/.mozilla/firefox/profiles.ini`), `--port <n>` / `GOLINKS_FF_PORT` (default 6005), `--addon <dir>`, `--binary <path>` / `GOLINKS_FF_BIN`, `--set-prefs`, `--restart`, `--headless`.

**Errors**: no profile (lists where it looked), port held by something that is not Firefox's debugger, Firefox's own message when the install is rejected, Firefox refusing to quit, and the server not closing afterwards.

**Tests**: `pnpm test:loader` (about 40 s; `pnpm test` runs it after the Firefox and Chrome suites): unit tests for the protocol framing, profile lookup and prefs, and an integration test that starts headless Firefox on a throwaway profile in `tests/load-firefox/.build/` (git-ignored). It checks that the add-on's background page really runs (the test add-on calls a local HTTP server), that the debugger port is closed after every run, that a reload does not restart Firefox (same pid), that the fallback to the restart prompt is quick when the forwarded command is not taken, that the window's `remotecontrol` attribute (logged from inside Firefox) goes from `true` to `null`, that `user.js` and `prefs.js` hold none of the three prefs while Firefox runs and after it quits, and the refuse/`--restart` paths. It never reads or touches a real profile. **Does not cover**: the real profile, a non-headless window in the suite (headless Firefox has no remoting, so step 2 is only exercised as "skipped, ask to restart"; its success side, including the default-branch prefs, was run by hand in a throwaway headful profile), the visual look of the URL bar, session restore of real tabs.

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