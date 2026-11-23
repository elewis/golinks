# Privacy policy

Effective 2026-11-22.

This extension redirects short links like `go/github` to addresses you choose. It keeps its data in your browser.

## Stored data

- **Links**: each link's name and destination.
- **Usage counts** (on by default): for each link, how often you used it, when you last used it and when you last edited it.
- **Redirect log** (off by default): for each `go/` visit, the time, the `go/` address, the link name, the destination and the tab number. On Firefox, if you typed `go/<name>` in the address bar and Firefox turned it into a search, the entry holds the search address instead. Entries older than 7 days are deleted, and at most 10,000 are kept.
- **Device ID**: a random identifier created on each device.
- **Settings**: appearance, table sort order, and whether usage counts and the redirect log are on.

Links are kept in your browser's sync storage. If you use browser sync, it copies them to your other devices. Everything else stays on the device.

Visits in private windows are not stored.

## Data sent

The extension makes no network requests. It has no analytics, ads, remote code or third-party services.

## Permissions

- `storage`: saves the data above.
- `declarativeNetRequestWithHostAccess` and access to `go/`: redirect `go/` links.
- `webRequest`: detects `go/` redirects for the usage counts and the redirect log.
- `activeTab`: fills in the current page's address when you add a link from the toolbar button or Alt+Shift+G.

Firefox also needs `webRequestBlocking` and access to all websites. Firefox turns `go/<name>` typed in the address bar into a search on your search engine, which can be any site. The extension checks page loads that did not come from a link on another page and redirects only searches for `go/` followed by a link name. It does not change or store any other request.

## Deleting your data

On the `go/help` page, under Settings:

- Turning off **Redirect log** deletes the log.
- **Clear metrics** deletes this device's usage counts and redirect log.
- **Reset to default** replaces your links with the defaults on every synced device and clears this device's usage counts, redirect log and settings.

Removing the extension deletes its data on that device. Synced links can stay in your browser account.

## Changes

This policy is kept in this repository, and its history is public. The effective date shows the latest change.

## Contact

Open an issue at https://github.com/elewis/golinks/issues.
