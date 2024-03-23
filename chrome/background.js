'use strict';

const links = [
    ['gh', 'https://github.com'],
    ['gg', 'https://google.com'],
    ['yt', 'https://youtube.com'],
    ['gmail', 'https://mail.google.com'],
    ['gcal', 'https://calendar.google.com'],
];

console.debug('Service worker started.');

links.forEach(([golink, destination], index) => {
    const id = index + 1;
    const url = "http://go/"+golink;
    console.debug(`Service worker, adding rule ${id}: ${url} ${destination}`)

    chrome.declarativeNetRequest.updateDynamicRules({
        addRules: [{
            "id": id,
            "priority": 1,
            "action": { "type": "redirect", "redirect": { "url": destination } },
            "condition": { "urlFilter": "http://go/"+golink, "resourceTypes": ["main_frame"] }
        }],
        removeRuleIds: [id]
    });
})

chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((e) => {
  console.debug(`Navigation to ${e.request.url} redirected on tab ${e.request.tabId}`);
});
