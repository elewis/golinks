"use strict";

importScripts("links.js");

(async () => {
  const links = await getLinks();

  function get_rule(golink, destination) {
    if (destination.includes("%s")) {
      // Redirect to link with user parameter
      return {
        priority: 5,
        action: {
          type: "redirect",
          redirect: {
            // Use regex match to pass the parameter value
            //
            // For example:
            // - User inputs: https://github.com/search?q=%s
            // - Chrome requires: https://github.com/search?q=\1
            regexSubstitution: destination.replace("%s", "\\1"),
          },
        },
        condition: {
          regexFilter: "^https?://go/" + golink + "(?:/([^/]*))?",
          resourceTypes: ["main_frame"],
        },
      };
    } else {
      // Redirect to static link
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

  const new_rules = Object.entries(links).map(([golink, destination]) => get_rule(golink, destination));

  // Redirect go/help to information page
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

  // Redirect bare go/ link to information page
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

  // Redirect any non-matching links to static 404 page
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
    addRules: new_rules.map((rule, index) => ({ id: index+1, ...rule })),
  });

  // chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((e) => {
  //   console.debug(`Redirecting ${e.request.url} on tab ${e.request.tabId}`);
  // });

  console.debug("Service worker started");

})();
