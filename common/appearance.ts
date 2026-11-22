// Appearance: Light, Dark or System, remembered per device in storage.local `appearance` (not synced).
// theme.css does the painting: <html data-theme="light|dark"> forces a mode, no attribute is System (it follows
// prefers-color-scheme, live, in CSS alone). This script only sets that attribute.
//
// No flash: storage.* is async, so the last choice is also cached in this origin's localStorage and applied
// synchronously when the script runs in <head>, before the first paint; storage.local (the truth) then confirms
// it, and a change made on another page arrives through storage.onChanged. Needs api.js. Loaded by every page.
type Appearance = "light" | "dark" | "system";

const APPEARANCE_KEY = "appearance";

// A stored value that is not a known mode is System.
function validAppearance(value: unknown): Appearance {
  return value === "light" || value === "dark" ? value : "system";
}

// The data-theme attribute for a mode: none for System.
function themeAttribute(value: unknown): "light" | "dark" | null {
  const mode = validAppearance(value);
  return mode === "system" ? null : mode;
}

function applyAppearance(value: unknown): void {
  const theme = themeAttribute(value);
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem(APPEARANCE_KEY, validAppearance(value));
  } catch {
    // no localStorage: the next load flashes at worst
  }
}

async function setAppearance(mode: Appearance): Promise<void> {
  applyAppearance(mode);
  await api.storage.local.set({ [APPEARANCE_KEY]: mode });
}

(async () => {
  if (typeof document === "undefined") return;
  try {
    const cached = localStorage.getItem(APPEARANCE_KEY);
    const theme = themeAttribute(cached);
    if (theme) document.documentElement.dataset.theme = theme;
  } catch {
    // no localStorage
  }
  api.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local" && changes[APPEARANCE_KEY]) applyAppearance(changes[APPEARANCE_KEY].newValue);
  });
  const stored: { appearance?: unknown } = await api.storage.local.get(APPEARANCE_KEY);
  applyAppearance(stored.appearance);
})().catch(() => {});
