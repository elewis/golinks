"use strict";

// Firefox-only pure logic, loaded before background.js so that Node tests can
// load it on its own. When `go/something` is typed in the address bar Firefox
// treats it as a search, so the request goes to the default search engine with
// the text in a query parameter (e.g. https://www.google.com/search?q=go%2Fsomething).
// Any host is watched, so regional and custom engines work. A request is only
// redirected when a query parameter starts with "go/" followed by a link name.
const SEARCH_PARAMS: readonly string[] = ["q", "p", "query", "text"];

// Returns the https://go/... URL a search request stands for, or null.
function goUrlFromSearch(url: string): string | null {
  let u: URL;
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
      return `https://go/${encodeURI(match[1])}`;
    }
  }
  return null;
}
