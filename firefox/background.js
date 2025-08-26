"use strict";

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

  const links = await getLinks();
  await updateRulesWithLinks(links);
  console.debug("GoLinks: extension loaded");
})();

// Listen for storage changes and update rules
browser.storage.onChanged.addListener(async (changes, namespace) => {
  if (namespace === "sync" && changes.links) {
    console.debug("GoLinks: links updated, refreshing rules");
    const links = changes.links.newValue;
    await updateRulesWithLinks(links);
  }
});

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
        regexFilter: "^https?://go/" + golink + "(?:/([^/]*))?",
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

// WebRequest API: catch "go/something" search queries and redirect to "https://go/something"
browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url;

    if (url.startsWith("https://go/")) {
      return;
    }

    // Look for "go/" pattern in URL (url encoded)
    if (url.includes("go%2F")) {
      const match = url.match(/go%2F\w+(%2F\w+)?/i);
      if (match) {
        const goLink = match[0];
        const redirectUrl = `https://${decodeURIComponent(goLink)}`;
        console.debug(
          "GoLinks: intercepting search for ",
          goLink,
          ", redirecting to:",
          redirectUrl
        );
        return { redirectUrl: redirectUrl };
      }
    }

    // Look for "go/" pattern in URL (not url encoded)
    if (url.includes("go/")) {
      const match = url.match(/go\/\w+(\/\w+)?/i);
      if (match) {
        const goLink = match[0];
        const redirectUrl = `https://${goLink}`;
        console.debug(
          "GoLinks: intercepting search for ",
          goLink,
          ", redirecting to:",
          redirectUrl
        );
        return { redirectUrl: redirectUrl };
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);
