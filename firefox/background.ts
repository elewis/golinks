"use strict";

// Firefox-only wiring. Rule generation is in rules.js (shared), search parsing
// and recording in search.js; this file adds the host-permission warning and
// the webRequest interception of address-bar searches for protocol-less go/ URLs.

startMetrics();

(async () => {
  // Check if we have the necessary permissions
  const hasPermissions = await api.permissions.contains({
    origins: ["http://go/*", "https://go/*"],
  });

  if (!hasPermissions) {
    console.warn("GoLinks: Missing host permissions for go/* URLs");
    console.warn("GoLinks: Please grant permissions in about:addons > GoLinks > Permissions");
  }

  await startRules();
})();

// WebRequest API: redirect address-bar searches for go/ links (see search.js).
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
  ["blocking"],
);
