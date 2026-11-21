// Globals for the Chrome program (common/ + chrome/). Chrome provides `chrome`;
// `browser` is absent there and only read by the shim in api.ts.
type Api = typeof chrome;
declare var browser: Api | undefined;
// Service worker global (the DOM lib the shared pages need does not declare it).
declare function importScripts(...urls: string[]): void;
type Rule = chrome.declarativeNetRequest.Rule;
