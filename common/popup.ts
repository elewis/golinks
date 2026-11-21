// Toolbar popup: the add-link form with the current tab's URL filled in.
(async () => {
  const container = document.getElementById("add-link");
  if (!container) throw new Error("popup.html has no #add-link");
  let url: string | undefined;
  try {
    // The tab's URL is readable here thanks to the activeTab permission.
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && /^https?:/.test(tab.url)) url = tab.url;
  } catch (e) {
    console.error("GoLinks: reading the active tab failed:", e);
  }
  initLinkForm(container, { url });
})();
