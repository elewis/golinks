"use strict";

// Rule updates are serialised on one promise chain. Two overlapping updates
// (startup plus the storage change that getLinks() itself triggers) would both
// read an empty rule list and then both add ids 1..N, failing with "Duplicate
// rule ID". Each queued task reads the links and the existing rules afresh, so
// the last task always leaves the rules matching the latest storage.
let rulesQueue = Promise.resolve();

function refreshRules() {
  const task = rulesQueue.then(async () => {
    const links = await getLinks();
    await updateRulesWithLinks(links);
  });
  // A failed update must not block later ones.
  rulesQueue = task.catch((e) => console.error("GoLinks: updating rules failed:", e));
  return task;
}

(async () => {
  // Check if we have the necessary permissions
  const hasPermissions = await browser.permissions.contains({
    origins: ["http://go/*", "https://go/*"],
  });

  if (!hasPermissions) {
    console.warn("GoLinks: Missing host permissions for go/* URLs");
    console.warn(
      "GoLinks: Please grant permissions in about:addons > GoLinks > Permissions"
    );
  }

  await refreshRules();
  console.debug("GoLinks: extension loaded");
})();

// Listen for storage changes and update rules
browser.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "sync" && (changes.localLinks || changes.defaultLinks)) {
    console.debug("GoLinks: links updated, refreshing rules");
    return refreshRules().catch(() => {});
  }
});

// Match a link name literally inside a regular expression.
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function get_rule(golink, destination) {
  if (destination.includes("%s")) {
    return {
      priority: 5,
      action: {
        type: "redirect",
        redirect: {
          regexSubstitution: destination.replace("%s", "\\1"),
        },
      },
      condition: {
        regexFilter: "^https?://go/" + escapeRegex(golink) + "(?:/([^/]*))?",
        resourceTypes: ["main_frame"],
      },
    };
  } else {
    return {
      priority: 5,
      action: {
        type: "redirect",
        redirect: { url: destination },
      },
      condition: {
        urlFilter: `||go/${golink}|`,
        resourceTypes: ["main_frame"],
      },
    };
  }
}

async function updateRulesWithLinks(links) {
  console.debug("GoLinks: updating rules with links:", links);
  const new_rules = Object.entries(links).map(([golink, destination]) =>
    get_rule(golink, destination)
  );
  console.debug("GoLinks: generated rules:", new_rules);

  // Add help and default rules - use extensionPath for Firefox compatibility
  new_rules.push({
    priority: 2,
    action: {
      type: "redirect",
      redirect: { extensionPath: "/index.html" },
    },
    condition: {
      urlFilter: "||go/help|",
      resourceTypes: ["main_frame"],
    },
  });

  new_rules.push({
    priority: 2,
    action: {
      type: "redirect",
      redirect: { extensionPath: "/index.html" },
    },
    condition: {
      urlFilter: "||go/|",
      resourceTypes: ["main_frame"],
    },
  });

  new_rules.push({
    priority: 1,
    action: {
      type: "redirect",
      redirect: { extensionPath: "/notfound.html" },
    },
    condition: {
      urlFilter: "||go/*",
      resourceTypes: ["main_frame"],
    },
  });

  const old_rules = await browser.declarativeNetRequest.getDynamicRules();
  const old_rule_ids = old_rules.map((rule) => rule.id);

  const rules_to_add = new_rules.map((rule, index) => ({
    id: index + 1,
    ...rule,
  }));
  console.debug("GoLinks: removing rule IDs:", old_rule_ids);
  console.debug("GoLinks: adding rules:", rules_to_add);

  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: old_rule_ids,
    addRules: rules_to_add,
  });

  console.debug("GoLinks: rules updated successfully");
}

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
      const { interceptions = [] } = await browser.storage.local.get("interceptions");
      interceptions.push(entry);
      await browser.storage.local.set({ interceptions: interceptions.slice(-MAX_INTERCEPTIONS) });
    })
    .catch((e) => console.error("GoLinks: recording interception failed:", e));
  return interceptionsQueue;
}

browser.webRequest.onBeforeRequest.addListener(
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
