"use strict";

// Redirect-rule generation and upkeep, shared by both browsers' background
// scripts. Needs api.js and links.js (getLinks) loaded first.

// Rule updates are serialised on one promise chain. Two overlapping updates
// (startup plus the storage change that getLinks() itself triggers) would both
// read an empty rule list and then both add ids 1..N, failing with "Duplicate
// rule ID". Each queued task reads the links and the existing rules afresh, so
// the last task always leaves the rules matching the latest storage.
let rulesQueue: Promise<unknown> = Promise.resolve();

function refreshRules(): Promise<void> {
  const task = rulesQueue.then(async () => {
    const links = await getLinks();
    await updateRulesWithLinks(links);
  });
  // A failed update must not block later ones.
  rulesQueue = task.catch((e) => console.error("GoLinks: updating rules failed:", e));
  return task;
}

// Rebuild the rules now, and again whenever the links change in storage.
async function startRules(): Promise<void> {
  await refreshRules();
  console.debug("GoLinks: extension loaded");
}

api.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "sync" && (changes.localLinks || changes.defaultLinks)) {
    console.debug("GoLinks: links updated, refreshing rules");
    return refreshRules().catch(() => {});
  }
});

// A redirect rule without its id (assigned when the rules are installed).
type RuleBody = Omit<Rule, "id">;

// Match a link name literally inside a regular expression.
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function get_rule(golink: string, destination: string): RuleBody {
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
        regexFilter: "^https?://go/" + escapeRegex(golink) + "(?:/(.*))?$",
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
        regexFilter: "^https?://go/" + escapeRegex(golink) + "$",
        resourceTypes: ["main_frame"],
      },
    };
  }
}

async function updateRulesWithLinks(links: Links): Promise<void> {
  console.debug("GoLinks: updating rules with links:", links);
  const new_rules = Object.entries(links).map(([golink, destination]) =>
    get_rule(golink, destination)
  );
  console.debug("GoLinks: generated rules:", new_rules);

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
    // The page gets the requested name (first path segment) as ?name=. The
    // regex covers the whole URL, since the substitution replaces only what
    // it matches.
    action: {
      type: "redirect",
      redirect: {
        regexSubstitution: api.runtime.getURL("notfound.html") + "?name=\\1",
      },
    },
    condition: {
      regexFilter: "^https?://go/([^/?#]*)(?:[/?#].*)?$",
      resourceTypes: ["main_frame"],
    },
  });

  const old_rules = await api.declarativeNetRequest.getDynamicRules();
  const old_rule_ids = old_rules.map((rule) => rule.id);

  const rules_to_add = new_rules.map((rule, index) => ({
    id: index + 1,
    ...rule,
  }));
  console.debug("GoLinks: removing rule IDs:", old_rule_ids);
  console.debug("GoLinks: adding rules:", rules_to_add);

  await api.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: old_rule_ids,
    addRules: rules_to_add,
  });

  console.debug("GoLinks: rules updated successfully");
}
