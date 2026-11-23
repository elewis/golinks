"use strict";

// One observation point for go/ redirects, shared by both browsers; consumers
// (usage metrics today, a redirect log later) attach with observeRedirects().
// Needs api.js. Observe only: nothing here can block or change a redirect.

// A finished redirect from http(s)://go/... as a plain fact.
type RedirectFact = {
  // First path segment of the go/ URL, lowercased ("" for the bare root).
  name: string;
  // The URL that was redirected, and where it went.
  from: string;
  to: string;
  requestId: string;
  tabId: number;
  // Unix milliseconds when the redirect was observed.
  time: number;
};

// `incognito` is Firefox's flag for a private-browsing request; Chrome's webRequest has none.
type RedirectDetails = { url: string; redirectUrl: string; requestId: string; tabId: number; incognito?: boolean };

// The fact for a redirect event, or null when `from` is not an http(s)://go/ URL.
function redirectFact(details: RedirectDetails, time: number): RedirectFact | null {
  let u: URL;
  try {
    u = new URL(details.url);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || u.hostname !== "go") return null;
  let name: string;
  try {
    name = decodeURIComponent(u.pathname.split("/")[1] ?? "").toLowerCase();
  } catch {
    return null;
  }
  return {
    name,
    from: details.url,
    to: details.redirectUrl,
    requestId: details.requestId,
    tabId: details.tabId,
    time,
  };
}

// Whether a redirect happened in a private window (Firefox private browsing,
// Chrome incognito); those are never stored. Firefox flags the request itself.
// Chrome does not, so the tab says (Tab.incognito needs no "tabs" permission).
// Anything unknown (no tab, tab already closed) counts as private: fail closed.
async function isPrivate(details: RedirectDetails): Promise<boolean> {
  if (typeof details.incognito === "boolean") return details.incognito;
  if (details.tabId < 0) return true;
  try {
    return (await api.tabs.get(details.tabId)).incognito !== false;
  } catch {
    return true;
  }
}

const redirectConsumers: Array<(fact: RedirectFact) => void> = [];

// Calls `consumer` for every go/ redirect. The browser listener is registered
// on the first call; call it synchronously at the top level of the background
// so that a Chrome service worker can be woken by the event.
function observeRedirects(consumer: (fact: RedirectFact) => void): void {
  if (redirectConsumers.length === 0) {
    // Facts are delivered in event order even when a tab lookup is slow.
    let delivered: Promise<void> = Promise.resolve();
    api.webRequest.onBeforeRedirect.addListener(
      (details) => {
        const fact = redirectFact(details, Date.now());
        if (!fact) return;
        const priv = isPrivate(details);
        delivered = delivered.then(async () => {
          if (await priv) return;
          for (const consumer of redirectConsumers) {
            try {
              consumer(fact);
            } catch (e) {
              console.error("GoLinks: redirect consumer failed:", e);
            }
          }
        });
      },
      { urls: ["http://go/*", "https://go/*"], types: ["main_frame"] },
    );
  }
  redirectConsumers.push(consumer);
}
