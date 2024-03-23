"use strict";

const links = [
  ["gh", "https://github.com"],
  ["gg", "https://google.com"],
  ["yt", "https://youtube.com"],
  ["gmail", "https://mail.google.com"],
  ["gcal", "https://calendar.google.com"],
];

(async () => {
  const new_rules = links.map(([golink, destination]) => {
    return {
      priority: 5,
      action: {
        type: "redirect",
        redirect: { url: destination },
      },
      condition: {
        urlFilter: "*://go/" + golink,
        resourceTypes: ["main_frame"],
      },
    };
  });

  // Redirect any non-matching links to static 404 page
  new_rules.push({
    priority: 1,
    action: {
      type: "redirect",
      redirect: { extensionPath: "/notfound.html" },
    },
    condition: {
      urlFilter: "*://go/*",
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
