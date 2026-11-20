"use strict";

importScripts("links.js");

// Rule updates are serialised on one promise chain. Two overlapping updates
// (startup plus the storage change that getLinks() itself triggers) would both
// read the same rule list and then both add ids 1..N, failing with a duplicate
// rule ID error. Each queued task reads the links and the existing rules
// afresh, so the last task always leaves the rules matching the latest storage.
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
  await refreshRules();
  console.debug("GoLinks: extension loaded");
})();

// Listen for storage changes and update rules
chrome.storage.onChanged.addListener((changes, namespace) => {
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
  const new_rules = Object.entries(links).map(([golink, destination]) =>
    get_rule(golink, destination)
  );

  // Add help and default rules
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

  const old_rules = await chrome.declarativeNetRequest.getDynamicRules();
  const old_rule_ids = old_rules.map((rule) => rule.id);

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: old_rule_ids,
    addRules: new_rules.map((rule, index) => ({ id: index + 1, ...rule })),
  });
}
