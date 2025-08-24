# GoLinks Chrome Extension

A Chrome extension that provides in-browser go/ links (e.g., `go/github`) for quick navigation to configured URLs.

## Overview

GoLinks allows you to create short redirect links that work in Chrome's address bar. Type `go/github` and get redirected to GitHub, or `go/githubsearch/query` to search GitHub with a parameter.

## Default Links

- `go/github`, `go/gh` → GitHub
- `go/githubsearch/[query]` → Search GitHub 
- `go/gg` → Google
- `go/yt` → YouTube
- `go/mail`, `go/gmail` → Gmail
- `go/gcal` → Google Calendar

## Installation

1. Clone this repository
2. Open `chrome://extensions/` in Chrome
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `chrome` folder

## Usage

### Static Links
- `go/github` → Redirects to GitHub
- `go/mail` → Redirects to Gmail

### Parameterized Links
- `go/githubsearch/react` → Searches GitHub for "react"
- `go/githubsearch/my project` → Searches GitHub for "my project"

### Special Pages
- `go/help` → Extension help page

## Configuration

Links are stored in Chrome's sync storage and can be modified programmatically:

```javascript
chrome.storage.sync.set({
  links: {
    "example": "https://example.com",
    "search": "https://example.com/search?q=%s"
  }
});
```

Use `%s` in URLs to create parameterized links that accept arguments.

## Technical Details

- Built for Chrome Manifest v3
- Uses `chrome.declarativeNetRequest` for redirects
- Configuration syncs across Chrome installations
- No external dependencies
