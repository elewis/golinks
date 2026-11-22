# GoLinks Browser Extensions

Browser extensions that provide in-browser go/ links (e.g., `go/github`) for quick navigation to configured URLs. Available for both **Chrome** and **Firefox** (Manifest V3), with the same features in both.

Type `go/github` and get redirected to GitHub, or `go/cs/react` to search GitHub for "react". Add your own links from the toolbar, and manage them all on `go/help`.

![go/help: every link with its hits, last hit and last edited, and the Danger zone](docs/images/help.png)

*Screenshots are of the Firefox build with sample links.*

## Features

- **Short links**: `go/<name>` redirects to the URL you saved. Names are case-insensitive (`go/GH` is `go/gh`).
- **Parameterized links**: a `%s` in the URL takes whatever follows the name, e.g. `go/cs/foo/bar` passes `foo/bar`.
- **Add a link in two clicks**: the toolbar button (or **Alt+Shift+G**) opens a form with the current page's URL filled in. Typing an unknown `go/<name>` lands on a not-found page with the same form and the name filled in. `go/help` has it too.
- **A URL without a scheme** is saved as `https://...` (`http://...` for `localhost`).
- **Sync**: links are stored in the browser's sync storage, one item per link, so they follow you across devices.
- **Usage metrics, per device**: hits, last hit and last edited for every link, shown on `go/help`. A redirect log is also recorded on each device (7 days, at most 10,000 entries); there is no screen for it yet.
- **No dependencies at runtime**: native browser APIs only, no network calls.

The toolbar popup and the not-found page share one add-link form:

![Toolbar popup](docs/images/popup.png) ![Not-found page](docs/images/not-found.png)

## The go/help page

`go/help` (also bare `go/`) lists all your links in one table with their hits, last hit, last edited and a delete button, and has the add-link form as its last row. Click a column header to sort by it; the choice is remembered on that device. At the bottom, under "Danger zone":

- **Clear metrics** clears the hit counts and the redirect log, on this device only. It asks for confirmation first. Your links are not touched.
- **Reset to default** (the very last thing on the page) is a full factory reset. It clears all your links and adds the shipped defaults again, on every synced device, and on this device it also clears the metrics, the redirect log and the saved sort order. It asks for confirmation first.

## Default Links

On first run these are added to your links once. They are ordinary links: change or delete any of them, and a deleted default stays deleted (until you use Reset to default).

- `go/github`, `go/gh` → GitHub
- `go/cs/[query]` → search GitHub code
- `go/gg` → Google
- `go/yt` → YouTube
- `go/mail`, `go/gmail` → Gmail
- `go/gcal` → Google Calendar

## Installation

Clone this repository, run `pnpm install` once (it installs only dev tooling: the formatter and the type checker; nothing ships in the extension), then build.

### Chrome
1. `pnpm build:chrome`
2. Open `chrome://extensions/` in Chrome
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `dist/chrome` folder

### Firefox
1. `pnpm build:firefox`
2. Open `about:debugging` in Firefox
3. Click "This Firefox"
4. Click "Load Temporary Add-on"
5. Select the `manifest.json` file from the `dist/firefox` folder
6. Grant host permissions when prompted

Instead of those clicks, `pnpm load:firefox` builds and installs the add-on into your everyday Firefox; run it again after an edit to reload. It is a developer tool; CLAUDE.md describes what it does to the profile and the risks.

`pnpm build` builds both. Load `dist/`, never edit it.

## Usage

- **Chrome**: type `https://go/github` in the address bar (Chrome treats a bare `go/github` as a search).
- **Firefox**: `go/github` works as typed, without the protocol.

Examples (both browsers): `go/github`, `go/mail`, `go/cs/react` (searches GitHub for "react"), `go/help`.

## Configuration

Use the toolbar button or `go/help`. To script it, links are sync storage items named `link:<name>` (name in lowercase) with the destination URL as the value; writing or removing one updates the redirect rules in both browsers.

```javascript
// Chrome; in Firefox use browser.storage.sync
chrome.storage.sync.set({
  "link:example": "https://example.com",
  "link:search": "https://example.com/search?q=%s"
});
chrome.storage.sync.remove("link:example");
```

Do not write `localLinks` (a legacy item, migrated at the next start) or `seeded:*` (the record of which defaults were added).

Rules of the names: not empty, no `/`, `?`, `#` or whitespace, and not `help`.

## Technical Details

- **Chrome**: Manifest V3 service worker, `declarativeNetRequest` for the redirects
- **Firefox**: Manifest V3 event page, `declarativeNetRequest` for the redirects plus a `webRequest` listener that catches `go/...` typed in the address bar (Firefox turns it into a search)
- **Cross-browser**: shared code lives once in `common/`; only the manifests, the two `background.ts` files and Firefox's `search.ts` differ
- **Source**: TypeScript with no compiler: the build strips the types with Node's `stripTypeScriptTypes`, and only Node built-ins are used
- **Look**: one stylesheet, `common/theme.css`, for every page; `common/styleguide.html` lists its tokens and components
- **Permissions**: `declarativeNetRequestWithHostAccess`, `storage`, `activeTab`, `webRequest` (Firefox also `webRequestBlocking`). Everything stays in your browser.

## Architecture

```
golinks/
├── common/          # TypeScript, HTML and CSS shared by both browsers
├── chrome/          # Chrome-only manifest and background
├── firefox/         # Firefox-only manifest, background and address-bar search logic
├── types/           # type declarations for the type check (never built)
├── scripts/         # build, load-firefox and screenshot scripts
├── tests/           # unit, build, browser and loader tests
└── CLAUDE.md        # Detailed technical documentation
```

## Development

Needs Node 24 and pnpm.

```
pnpm test        # Biome check, type check, build and unit tests (about a second, no browser)
pnpm test:full   # also the headless Firefox and Chrome suites and the loader test
pnpm format      # Biome formatter; run before committing
pnpm screenshot  # saves PNGs of the pages to .screenshots/ (git-ignored)
```

The browser suites need snap Firefox with `geckodriver` and Google Chrome; see CLAUDE.md for the prerequisites and what they cover. CLAUDE.md is also where the storage layout, the metrics and redirect-log design and the cross-browser parity rules are written down.
