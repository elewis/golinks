// Link name (without "go/") to destination URL; a destination with %s takes a parameter.
type Links = Record<string, string>;

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

  // Always update defaultLinks if different from current defaults
  if (
    !result.defaultLinks ||
    JSON.stringify(result.defaultLinks) !== JSON.stringify(defaultLinks)
  ) {
    console.debug("GoLinks: updating default links");
    await api.storage.sync.set({ defaultLinks });
  }

  const localLinks = result.localLinks || {};

  // Merge links: localLinks override defaultLinks
  return { ...defaultLinks, ...localLinks };
}

// The merged links as getLinks() returns them, but without writing storage
// when the defaults are already there (the pages read often; only the
// background needs getLinks()'s refresh of the stored defaults).
async function readLinks(): Promise<Links> {
  const result: { defaultLinks?: Links; localLinks?: Links } = await api.storage.sync.get(["defaultLinks", "localLinks"]);
  if (!result.defaultLinks) return getLinks();
  return { ...result.defaultLinks, ...(result.localLinks || {}) };
}
