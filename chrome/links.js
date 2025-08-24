async function getLinks() {
  // Try to get links from storage first
  const result = await chrome.storage.sync.get(['links']);
  
  if (result.links && Object.keys(result.links).length > 0) {
    return result.links;
  }

  // Fallback to default links if storage is empty
  const defaultLinks = {
    "github": "https://github.com",
    "gh": "https://github.com",
    "githubsearch": "https://github.com/search?q=%s",
    "gg": "https://google.com",
    "yt": "https://youtube.com",
    "mail": "https://mail.google.com",
    "gmail": "https://mail.google.com",
    "gcal": "https://calendar.google.com"
  };

  console.debug('GoLinks: initializing with default links');

  // Initialize storage with default links
  await chrome.storage.sync.set({ links: defaultLinks });
  return defaultLinks;
}
