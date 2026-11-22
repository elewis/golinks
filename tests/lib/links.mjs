// Chrome tests and the screenshot script run JavaScript inside an extension
// page. Links are one sync item each, `link:<name>`; these build the source of
// an async expression for that page.

/** Makes the stored links exactly `links`; resolves to true. */
export function setLinksExpr(links) {
  return `(async () => {
    const wanted = ${JSON.stringify(links)};
    const all = await chrome.storage.sync.get(null);
    const gone = Object.keys(all).filter((k) => k.startsWith("link:") && !(k.slice(5) in wanted));
    if (gone.length) await chrome.storage.sync.remove(gone);
    await chrome.storage.sync.set(Object.fromEntries(Object.entries(wanted).map(([n, u]) => ["link:" + n, u])));
    return true;
  })()`;
}

/** The stored links, name -> URL. */
export const storedLinksExpr = `chrome.storage.sync.get(null).then((all) =>
  Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith("link:")).map(([k, v]) => [k.slice(5), v])))`;
