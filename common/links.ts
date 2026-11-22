// Link name (without "go/") to destination URL; a destination with %s takes a parameter.
type Links = Record<string, string>;

// Link names are case-insensitive (go/GH and go/gh are one link); the
// canonical form is lowercase.
//
// Returns the stored links with lowercased keys. Of several stored keys that
// differ only in case, the exact lowercase one wins, else the last in the
// object. Storage is not rewritten.
function lowercaseLinks(stored: Links): Links {
  const out: Links = {};
  const exact = new Set<string>();
  for (const [key, url] of Object.entries(stored)) {
    const name = key.toLowerCase();
    if (key === name) exact.add(name);
    else if (exact.has(name)) continue;
    out[name] = url;
  }
  return out;
}

// The links shipped with the extension. They are only the initial set: each is
// copied into the user's links once (see seedDefaults) and is then an ordinary link.
const SHIPPED_LINKS: Links = {
  github: "https://github.com",
  gh: "https://github.com",
  cs: "https://github.com/search?q=%s", // cs = code search
  gg: "https://google.com",
  yt: "https://youtube.com",
  mail: "https://mail.google.com",
  gmail: "https://mail.google.com",
  gcal: "https://calendar.google.com",
};

// Sync storage holds one item per link, `link:<name>` -> destination URL (name
// lowercase), so that a write or a conflict between devices concerns one link
// only. Nothing reads links from another key. A default that was seeded is
// recorded as `seeded:<name>` -> true, whether or not its link still exists, so
// a deleted default is never added again (on any device).
const LINK_PREFIX = "link:";
const SEEDED_PREFIX = "seeded:";

// The key of a link in sync storage.
function linkKey(name: string): string {
  return LINK_PREFIX + name.toLowerCase();
}

// The links among the stored sync items (lowercased names).
function linksFromItems(items: Record<string, unknown>): Links {
  const links: Links = {};
  for (const [key, value] of Object.entries(items)) {
    if (key.startsWith(LINK_PREFIX) && typeof value === "string") links[key.slice(LINK_PREFIX.length)] = value;
  }
  return lowercaseLinks(links);
}

// The links before and after a storage.onChanged event (sync area), built from
// the `link:*` keys that changed; null when no link key changed. A link only in
// `after` was added, only in `before` removed.
function linkChanges(changes: Record<string, { oldValue?: unknown; newValue?: unknown }>): {
  before: Links;
  after: Links;
} | null {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  let any = false;
  for (const [key, change] of Object.entries(changes)) {
    if (!key.startsWith(LINK_PREFIX)) continue;
    any = true;
    before[key] = change.oldValue;
    after[key] = change.newValue;
  }
  return any ? { before: linksFromItems(before), after: linksFromItems(after) } : null;
}

// Preparing the links runs one at a time: startup and a storage change that
// overlap would both read the old state and both write. Each task reads storage
// afresh.
let seedQueue: Promise<unknown> = Promise.resolve();

// Migration, then seeding, in one task (migration first):
// - A legacy `localLinks` item (one object with every link, written by earlier
//   versions) is copied to `link:<lowercase name>` unless that key exists (the
//   per-link key wins; of stored keys that differ only in case the exact
//   lowercase one wins), then removed together with the old `defaultLinks`
//   record (which does not count as seeded). Idempotent: another device doing
//   the same writes the same values. An old-version device that writes
//   `localLinks` again is migrated on the next start (which can bring back a
//   link deleted in between).
// - Each shipped default without a `seeded:` key is added as `link:<name>`
//   unless that key exists (the user's link wins), and recorded as seeded. A
//   deleted default stays deleted.
// One storage.set writes the new items; the legacy items are removed after it.
// Nothing is written when there is nothing to do.
function seedDefaults(): Promise<void> {
  const task = seedQueue.then(async () => {
    const stored: Record<string, unknown> = await api.storage.sync.get(null);
    const items: Record<string, unknown> = {};
    const taken = (key: string) => key in stored || key in items;
    const legacy = stored.localLinks;
    if (legacy && typeof legacy === "object") {
      for (const [name, url] of Object.entries(lowercaseLinks(legacy as Links))) {
        if (!taken(linkKey(name))) items[linkKey(name)] = url;
      }
    }
    for (const [name, url] of Object.entries(SHIPPED_LINKS)) {
      if (SEEDED_PREFIX + name in stored) continue;
      if (!taken(linkKey(name))) items[linkKey(name)] = url;
      items[SEEDED_PREFIX + name] = true;
    }
    const obsolete = ["localLinks", "defaultLinks"].filter((key) => key in stored);
    if (Object.keys(items).length === 0 && obsolete.length === 0) return;
    console.debug("GoLinks: migrating and seeding links");
    if (Object.keys(items).length > 0) await api.storage.sync.set(items);
    if (obsolete.length > 0) await api.storage.sync.remove(obsolete);
  });
  // A failed task must not block later ones.
  seedQueue = task.catch((e) => console.error("GoLinks: migrating or seeding links failed:", e));
  return task;
}

// The links (lowercased names), after migrating and seeding. For the
// background; pages use readLinks().
async function getLinks(): Promise<Links> {
  await seedDefaults();
  return readLinks();
}

// The links as getLinks() returns them, without migrating, seeding or writing
// storage (the pages read often): every `link:*` item.
async function readLinks(): Promise<Links> {
  return linksFromItems(await api.storage.sync.get(null));
}
