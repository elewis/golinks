# GoLinks Browser Extensions

Browser extensions that provide in-browser go/ links (e.g., `go/github`) for quick navigation to configured URLs. Available for both **Chrome** and **Firefox**.

## Overview

GoLinks allows you to create short redirect links that work in your browser's address bar. Type `go/github` and get redirected to GitHub, or `go/githubsearch/query` to search GitHub with a parameter.

## Default Links

- `go/github`, `go/gh` → GitHub
- `go/githubsearch/[query]` → Search GitHub 
- `go/gg` → Google
- `go/yt` → YouTube
- `go/mail`, `go/gmail` → Gmail
- `go/gcal` → Google Calendar

## Installation

### Chrome
1. Clone this repository
2. Open `chrome://extensions/` in Chrome
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `chrome` folder

### Firefox
1. Clone this repository
2. Open `about:debugging` in Firefox
3. Click "This Firefox"
4. Click "Load Temporary Add-on"
5. Select the `manifest.json` file from the `firefox` folder
6. Grant host permissions when prompted

## Usage

### Chrome
- `https://go/github` → Redirects to GitHub
- `https://go/mail` → Redirects to Gmail
- `https://go/githubsearch/react` → Searches GitHub for "react"

### Firefox
- `go/github` → Redirects to GitHub (protocol-less works!)
- `go/mail` → Redirects to Gmail  
- `go/githubsearch/react` → Searches GitHub for "react"

### Special Pages (Both Browsers)
- `go/help` → Extension help page

## Key Features

### Chrome
- Full Manifest V3 compatibility
- Requires `https://` protocol in address bar
- Service worker architecture

### Firefox  
- Protocol-less URLs work directly (`go/github` vs `https://go/github`)
- Hybrid webRequest + declarativeNetRequest architecture
- Event page background script
- No external dependencies or polyfills

## Configuration

Links are stored in browser sync storage and can be modified programmatically:

### Chrome
```javascript
chrome.storage.sync.set({
  links: {
    "example": "https://example.com",
    "search": "https://example.com/search?q=%s"
  }
});
```

### Firefox
```javascript
browser.storage.sync.set({
  links: {
    "example": "https://example.com", 
    "search": "https://example.com/search?q=%s"
  }
});
```

Use `%s` in URLs to create parameterized links that accept arguments.

## Technical Details

- **Chrome**: Manifest V3 with service workers and `chrome.declarativeNetRequest`
- **Firefox**: Manifest V3 with event pages, `browser.declarativeNetRequest` + `browser.webRequest`
- **Cross-browser**: No shared polyfills, each optimized for its platform
- **Storage**: Configuration syncs across browser installations
- **Dependencies**: None - uses native browser APIs only

## Architecture

```
golinks/
├── chrome/          # Chrome-optimized version
├── firefox/         # Firefox-optimized version  
└── CLAUDE.md        # Detailed technical documentation
```
