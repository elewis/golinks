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
Navigate to `https://go/github`, `https://go/githubsearch/test`, or `https://go/help`. Check service worker console at `chrome://extensions/`.

### Firefox  
Navigate to `go/github` (protocol-less works!), `https://go/githubsearch/test`, or `https://go/help`. Check extension console at `about:debugging`.

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