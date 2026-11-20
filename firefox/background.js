"use strict";

// Firefox-only wiring. Rule generation is in rules.js (shared); this file adds
// the host-permission warning and the webRequest interception of address-bar
// searches for protocol-less go/ URLs.

(async () => {
  // Check if we have the necessary permissions
  const hasPermissions = await api.permissions.contains({
    origins: ["http://go/*", "https://go/*"],
  });

  if (!hasPermissions) {
    console.warn("GoLinks: Missing host permissions for go/* URLs");
    console.warn(
      "GoLinks: Please grant permissions in about:addons > GoLinks > Permissions"
    );
  }

  await startRules();
})();

// WebRequest API: when `go/something` is typed in the address bar Firefox treats
// it as a search, so the request goes to the default search engine with the text
// in a query parameter (e.g. https://www.google.com/search?q=go%2Fsomething).
// Any host is watched, so regional and custom engines work. A request is only
// redirected when a query parameter starts with "go/" followed by a link name.
const SEARCH_PARAMS = ["q", "p", "query", "text"];

// Returns the https://go/... URL a search request stands for, or null.
function goUrlFromSearch(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) {
    return null;
  }
  for (const param of SEARCH_PARAMS) {
    const query = (u.searchParams.get(param) ?? "").trim();
    // "go/" followed by a non-empty link name (no whitespace), then anything.
    const match = query.match(/^go\/(\S+(?:\s.*)?)$/i);
    if (match) {
      return "https://go/" + encodeURI(match[1]);
    }
  }
  return null;
}

// Every interception is logged in storage.local (a per-device log, so not sync)
// under `interceptions`: an array, newest last, capped at MAX_INTERCEPTIONS.
// Entry: { at: ISO timestamp, from: the original search URL, to: the https://go/
// URL, tabId }. Writes are serialised on one promise chain so a burst loses
// nothing; the caller does not wait for them.
const MAX_INTERCEPTIONS = 100;
let interceptionsQueue = Promise.resolve();

function recordInterception(details, redirectUrl) {
  const entry = {
    at: new Date().toISOString(),
    from: details.url,
    to: redirectUrl,
    tabId: details.tabId,
  };
  interceptionsQueue = interceptionsQueue
    .then(async () => {
      const { interceptions = [] } = await api.storage.local.get("interceptions");
      interceptions.push(entry);
      await api.storage.local.set({ interceptions: interceptions.slice(-MAX_INTERCEPTIONS) });
    })
    .catch((e) => console.error("GoLinks: recording interception failed:", e));
  return interceptionsQueue;
}

api.webRequest.onBeforeRequest.addListener(
  (details) => {
    // A navigation typed in the address bar has no originUrl; a link
    // click or form submit from a page does. Leave the latter alone.
    if (details.originUrl) {
      return;
    }
    const redirectUrl = goUrlFromSearch(details.url);
    if (redirectUrl) {
      console.debug("GoLinks: intercepting search, redirecting to:", redirectUrl);
      recordInterception(details, redirectUrl);
      return { redirectUrl };
    }
  },
  {
    urls: ["<all_urls>"],
    types: ["main_frame"],
  },
  ["blocking"]
);
