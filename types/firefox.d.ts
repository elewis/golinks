// Globals for the Firefox program (common/ + firefox/). Firefox provides
// `browser`; `chrome` exists there too but is only read by the shim in api.ts.
type Api = typeof browser;
declare var chrome: Api | undefined;
type Rule = browser.declarativeNetRequest.Rule;
