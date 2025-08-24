async function getLinks() {
  // Get both defaultLinks and localLinks from storage
  const result = await browser.storage.sync.get(["defaultLinks", "localLinks"]);

  const defaultLinks = {
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
    await browser.storage.sync.set({ defaultLinks });
  }

  const localLinks = result.localLinks || {};

  // Merge links: localLinks override defaultLinks
  return { ...defaultLinks, ...localLinks };
}
