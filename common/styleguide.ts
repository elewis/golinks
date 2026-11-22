// The style guide page: lists every custom property of theme.css's :root rule, grouped, each with its
// value read from the stylesheet. The swatches, type samples and space bars take their look from
// rules generated here (a constructed stylesheet: no inline style, no colour literal in the source).
(() => {
  const root = document.documentElement;

  // The :root custom properties of theme.css, in file order.
  const names: string[] = [];
  for (const sheet of document.styleSheets) {
    if (!sheet.href?.endsWith("theme.css")) continue;
    for (const rule of sheet.cssRules) {
      if (!(rule instanceof CSSStyleRule) || rule.selectorText !== ":root") continue;
      for (const name of rule.style) if (name.startsWith("--")) names.push(name);
    }
  }
  const value = (name: string) => getComputedStyle(root).getPropertyValue(name).trim();

  const generated: string[] = [];
  const row = (host: string, name: string, cls: string, rule: string, sample?: string) => {
    generated.push(`.${cls} { ${rule} }`);
    const el = document.createElement("div");
    el.className = "guide-token";
    const mark = document.createElement("div");
    mark.className = sample === undefined ? cls : `${cls} guide-sample`;
    if (sample !== undefined) mark.textContent = sample;
    const label = document.createElement("div");
    label.className = "name";
    label.textContent = name;
    const val = document.createElement("div");
    val.className = "value";
    val.textContent = value(name);
    el.append(mark, label, val);
    document.getElementById(host)?.append(el);
  };

  for (const name of names) {
    const id = name.slice(2);
    if (name.startsWith("--color-")) {
      row("guide-colors", name, `sw-${id}`, `background: var(${name});`);
      document.querySelector(`.sw-${id}`)?.classList.add("swatch");
    } else if (name.startsWith("--font-")) {
      row("guide-fonts", name, `f-${id}`, `font-family: var(${name});`, "Aa Go links 0123");
    } else if (name.startsWith("--text-")) {
      row("guide-sizes", name, `t-${id}`, `font-size: var(${name});`, "The quick brown fox");
    } else if (name.startsWith("--weight-")) {
      row("guide-weights", name, `w-${id}`, `font-weight: var(${name});`, "The quick brown fox");
    } else if (name.startsWith("--space-")) {
      row("guide-space", name, `sp-${id}`, `width: var(${name});`);
      document.querySelector(`.sp-${id}`)?.classList.add("space-bar");
    } else if (name === "--radius") {
      row("guide-shape", name, "sh-radius", "border-radius: var(--radius);");
      document.querySelector(".sh-radius")?.classList.add("shape-box");
    } else if (name === "--control-height") {
      row("guide-shape", name, "sh-control", "height: var(--control-height);");
      document.querySelector(".sh-control")?.classList.add("shape-box");
    } else if (name === "--shadow-popup") {
      row("guide-shape", name, "sh-shadow", "box-shadow: var(--shadow-popup);");
      document.querySelector(".sh-shadow")?.classList.add("shape-box");
    }
  }

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(generated.join("\n"));
  document.adoptedStyleSheets = [sheet];

  // The focus example, shown in its focused state.
  document.getElementById("g-focus")?.focus({ preventScroll: true });
  // Not ready when no token was found (theme.css missing), so a broken guide is not screenshotted as fine.
  if (names.length > 0) document.body.dataset.ready = "1";
})();
