// Link name (without "go/") to destination URL; a destination with %s takes a parameter.
type Links = Record<string, string>;

// Link names are case-insensitive (go/GH and go/gh are one link); the
// canonical form is lowercase.
//
// Merges stored links into one object with lowercased keys, local over
// default. Of several stored keys that differ only in case, the exact
// lowercase one wins, else the last in the object. Storage is not rewritten.
function mergeLinks(defaults: Links, locals: Links): Links {
  const lowercased = (stored: Links): Links => {
    const out: Links = {};
    const exact = new Set<string>();
    for (const [key, url] of Object.entries(stored)) {
      const name = key.toLowerCase();
      if (key === name) exact.add(name);
      else if (exact.has(name)) continue;
      out[name] = url;
    }
    return out;
  };
  return { ...lowercased(defaults), ...lowercased(locals) };
}

// The links without any key equal to the name, ignoring case.
function removeLinkName(links: Links, name: string): Links {
  const lower = name.toLowerCase();
  return Object.fromEntries(Object.entries(links).filter(([key]) => key.toLowerCase() !== lower));
}

// Same names and destinations, whatever the key order.
function sameLinks(a: Links, b: Links): boolean {
  const names = Object.keys(a);
  return names.length === Object.keys(b).length && names.every((n) => Object.hasOwn(b, n) && a[n] === b[n]);
}

async function getLinks(): Promise<Links> {
  // Get both defaultLinks and localLinks from storage
  const result: { defaultLinks?: Links; localLinks?: Links } = await api.storage.sync.get(["defaultLinks", "localLinks"]);

  const defaultLinks: Links = {
    github: "https://github.com",
    gh: "https://github.com",
    cs: "https://github.com/search?q=%s", // cs = code search
    gg: "https://google.com",
    yt: "https://youtube.com",
    mail: "https://mail.google.com",
    gmail: "https://mail.google.com",
    gcal: "https://calendar.google.com",
  };

  // Update defaultLinks if different from the current defaults. Key order is
  // ignored: Chrome returns stored objects with sorted keys, so a string
  // comparison would differ on every call and rewrite the same data.
  if (!result.defaultLinks || !sameLinks(result.defaultLinks, defaultLinks)) {
    console.debug("GoLinks: updating default links");
    await api.storage.sync.set({ defaultLinks });
  }

  // Merge links: localLinks override defaultLinks
  return mergeLinks(defaultLinks, result.localLinks || {});
}

// The merged links as getLinks() returns them, but without writing storage
// when the defaults are already there (the pages read often; only the
// background needs getLinks()'s refresh of the stored defaults).
async function readLinks(): Promise<Links> {
  const result: { defaultLinks?: Links; localLinks?: Links } = await api.storage.sync.get(["defaultLinks", "localLinks"]);
  if (!result.defaultLinks) return getLinks();
  return mergeLinks(result.defaultLinks, result.localLinks || {});
}
