// Not-found page for go/<name>: the add-link form with <name> filled in.
// The redirect rule passes the name as ?name= (see updateRulesWithLinks).
(() => {
  const container = document.getElementById("add-link");
  const title = document.getElementById("notfound-title");
  if (!container || !title) throw new Error("notfound.html has no #add-link or #notfound-title");
  // Not URLSearchParams: it would turn a "+" in the name (go/c++) into a space.
  const raw = /[?&]name=([^&]*)/.exec(location.search)?.[1] ?? "";
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {}
  if (name) title.textContent = `go/${name} does not exist yet`;
  initLinkForm(container, { name });
})();
