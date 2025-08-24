async function getLinks() {
  console.log('getLinks() called');
  
  // Try to get links from storage first
  const result = await chrome.storage.sync.get(['links']);
  console.log('Storage result:', result);
  
  if (result.links && Object.keys(result.links).length > 0) {
    console.log('Returning links from storage');
    return result.links;
  }

  // Fallback to default links from JSON file if storage is empty
  console.log('Using default links');
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

  // Initialize storage with default links
  console.log('Setting default links in storage');
  await chrome.storage.sync.set({ links: defaultLinks });
  return defaultLinks;
}
