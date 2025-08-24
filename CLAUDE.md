# GoLinks Chrome Extension

## Overview
A Chrome extension that provides in-browser go/ links (e.g., `go/github`) that redirect to configured URLs. Built for Manifest v3 with dynamic configuration via Chrome's storage API.

## Architecture

### Key Files
- `manifest.json` - Extension configuration with Manifest v3, requires `declarativeNetRequestWithHostAccess` and `storage` permissions
- `background.js` - Service worker that manages redirect rules using Chrome's declarativeNetRequest API
- `links.js` - Handles link storage/retrieval from Chrome's sync storage
- `index.html` - Help page shown for `go/help` and bare `go/` URLs
- `notfound.html` - 404 page for unmatched go/ links

### How It Works
1. **Initialization**: Service worker loads links from Chrome storage, creates redirect rules
2. **Storage Integration**: Uses `chrome.storage.sync` for configurable links that sync across devices  
3. **Dynamic Updates**: Storage change listener automatically updates rules when links are modified
4. **Rule Generation**: Single `get_rule()` function handles both parameterized (`%s`) and static redirects

### Link Types
- **Static**: `"github": "https://github.com"` → `go/github` redirects to GitHub
- **Parameterized**: `"githubsearch": "https://github.com/search?q=%s"` → `go/githubsearch/query` passes `query` as parameter

## Recent Fixes & Improvements
- **Fixed CSP violations** that broke the extension in modern Chrome
- **Eliminated code duplication** by consolidating rule generation logic  
- **Made links configurable** without extension reload via Chrome storage API
- **Added proper error handling** and minimal production logging

## Development Notes
- Uses `importScripts()` to load shared functions in service worker
- Rules are dynamically managed via `chrome.declarativeNetRequest` 
- Storage changes trigger automatic rule updates without service worker restart
- Extension initializes with default links if storage is empty

## Testing
Navigate to `go/github`, `go/githubsearch/test`, or `go/help` to verify functionality. Check service worker console at `chrome://extensions/` for debugging.

## Configuration
Links can be updated programmatically:
```javascript
chrome.storage.sync.set({
  links: {
    "github": "https://github.com",
    "newlink": "https://example.com"
  }
});
```