"use strict";

// Per-device log of every go/ navigation, shared by both browsers. Needs
// api.js and redirects.js. The backgrounds call startRedirectLog().
//
// Stored in storage.local (per device, not synced). One entry per navigation, however many hops it took:
// - a go/ -> go/ hop (the http -> https upgrade) is no entry of its own; the
//   entry keeps the first hop's `from`,
// - a Firefox address-bar search is no entry of its own either: the background
//   passes it to noteSearchRedirect(), and it becomes the `from` of the go/ hop
//   that follows (same requestId). A search that never reaches go/ logs nothing.
// Layout: one storage.local key per UTC day, `redirectLog:YYYY-MM-DD` (the day
// of the entry's `at`), each an array of that day's entries, newest last. A
// write rewrites only the entry's day key.
// Unknown names are logged too (their `to` is the not-found page; metrics skip
// them). go/help, the bare go/ root and any other extension page are not
// (the same rule as hitName() in metrics.ts: `to` inside the extension).
//
// New optional fields may be added to an entry later; old entries lack them.
// Times are Unix seconds, like linkMetrics.
type RedirectLogEntry = {
  at: number;
  // The search URL when Firefox intercepted a search, else the go/ URL as requested.
  from: string;
  // Lowercase first path segment of the go/ URL ("" for the bare root).
  link: string;
  // The final resolved destination (%s substituted; the not-found page for an unknown name).
  to: string;
  tabId: number;
};

const REDIRECT_LOG_MAX_AGE = 7 * 24 * 60 * 60; // seconds
const REDIRECT_LOG_MAX_ENTRIES = 10000;
// How long a pending hop (search or go/ -> go/) waits for the next one, in ms.
const REDIRECT_PENDING_TTL = 60_000;

const REDIRECT_LOG_PREFIX = "redirectLog:";
const REDIRECT_DAY = 24 * 60 * 60; // seconds

// The storage key of the UTC day of `at` (Unix seconds).
function redirectDayKey(at: number): string {
  return REDIRECT_LOG_PREFIX + new Date(at * 1000).toISOString().slice(0, 10);
}

// Unix seconds at which the day of `key` ends, or null for a key that is not a day.
function redirectDayEnd(key: string): number | null {
  const ms = Date.parse(`${key.slice(REDIRECT_LOG_PREFIX.length)}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms / 1000 + REDIRECT_DAY;
}

// What a write must do, given the day keys read (`days`: key -> entries). Pure.
// The entry goes into its day's key. Day keys whose day ended more than 7 days
// before `now` are removed; then the total is cut to the last 10,000 entries,
// oldest keys first.
function planRedirectWrite(
  days: Record<string, RedirectLogEntry[]>,
  entry: RedirectLogEntry,
  now: number,
): { set: Record<string, RedirectLogEntry[]>; remove: string[] } {
  const todayKey = redirectDayKey(entry.at);
  const all: Record<string, RedirectLogEntry[]> = { ...days, [todayKey]: [...(days[todayKey] ?? []), entry] };
  const remove: string[] = [];
  for (const key of Object.keys(all)) {
    const end = redirectDayEnd(key);
    if (end !== null && end < now - REDIRECT_LOG_MAX_AGE) {
      remove.push(key);
      delete all[key];
    }
  }
  const set: Record<string, RedirectLogEntry[]> = { [todayKey]: all[todayKey] };
  let excess = Object.values(all).reduce((n, list) => n + list.length, 0) - REDIRECT_LOG_MAX_ENTRIES;
  for (const key of Object.keys(all).sort()) {
    if (excess <= 0) break;
    const list = all[key];
    if (excess >= list.length) {
      remove.push(key);
      delete set[key];
      excess -= list.length;
    } else {
      set[key] = list.slice(excess);
      excess = 0;
    }
  }
  return { set, remove };
}

// `from` URLs waiting for the next hop of a request, by requestId: a search
// URL noted by Firefox, or the first go/ URL of a go/ -> go/ chain. In memory
// only, dropped after REDIRECT_PENDING_TTL so the map cannot grow.
const redirectPending = new Map<string, { from: string; at: number }>();

function prunePending(now: number): void {
  for (const [id, p] of redirectPending) {
    if (now - p.at > REDIRECT_PENDING_TTL) redirectPending.delete(id);
  }
}

// Firefox only: the address-bar search `searchUrl` (request `requestId`) was
// redirected to a go/ URL. `now` is Unix milliseconds.
function noteSearchRedirect(requestId: string, searchUrl: string, now: number = Date.now()): void {
  prunePending(now);
  redirectPending.set(requestId, { from: searchUrl, at: now });
}

// Whether a navigation that ended at `to` is logged: anything outside the
// extension, plus the not-found page. Other extension pages (go/help, bare go/) are not.
function isLoggedTarget(to: string, extensionBase: string): boolean {
  return !to.startsWith(extensionBase) || to.startsWith(`${extensionBase}notfound.html`);
}

// The entry for a redirect fact, or null while the navigation is still on its
// way (the fact went to another go/ URL). Takes and updates the pending hops.
function logEntryFor(fact: RedirectFact, extensionBase: string): RedirectLogEntry | null {
  prunePending(fact.time);
  const from = redirectPending.get(fact.requestId)?.from ?? fact.from;
  if (/^https?:\/\/go(?:[/?#]|$)/i.test(fact.to)) {
    redirectPending.set(fact.requestId, { from, at: fact.time });
    return null;
  }
  redirectPending.delete(fact.requestId);
  if (!isLoggedTarget(fact.to, extensionBase)) return null;
  return { at: Math.floor(fact.time / 1000), from, link: fact.name, to: fact.to, tabId: fact.tabId };
}

// The storage layer, kept apart from the logic above so the layout can change.
// The first write after a start looks at every key (storage.local.get(null)) to
// clear what is left from an earlier run; later writes only read the last days
// by name and remove the expired ones by name.
let redirectLogSwept = false;

function redirectWindowKeys(now: number): { read: string[]; stale: string[] } {
  const today = Math.floor(now / REDIRECT_DAY);
  const key = (d: number) => redirectDayKey(d * REDIRECT_DAY);
  const days = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => key(from + i));
  return { read: days(today - 8, today), stale: days(today - 38, today - 9) };
}

async function readRedirectDays(keys: string[] | null): Promise<Record<string, RedirectLogEntry[]>> {
  const stored: Record<string, unknown> = await api.storage.local.get(keys);
  const days: Record<string, RedirectLogEntry[]> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (key.startsWith(REDIRECT_LOG_PREFIX) && Array.isArray(value)) days[key] = value;
  }
  return days;
}

// The whole log in order (every day key, oldest first), for tests and a later export.
async function readRedirectLog(): Promise<RedirectLogEntry[]> {
  const days = await readRedirectDays(null);
  return Object.keys(days)
    .sort()
    .flatMap((key) => days[key]);
}

// Writes are serialised on one promise chain so a burst loses nothing and a
// failure does not block the next write. The listener does not wait.
let redirectLogQueue: Promise<unknown> = Promise.resolve();

function appendRedirectLog(entry: RedirectLogEntry, now: number = Math.floor(Date.now() / 1000)): Promise<unknown> {
  redirectLogQueue = redirectLogQueue
    .then(async () => {
      const window = redirectWindowKeys(now);
      const days = await readRedirectDays(redirectLogSwept ? window.read : null);
      const plan = planRedirectWrite(days, entry, now);
      const remove = redirectLogSwept ? [...plan.remove, ...window.stale] : plan.remove;
      await api.storage.local.set(plan.set);
      if (remove.length > 0) await api.storage.local.remove(remove);
      redirectLogSwept = true;
    })
    .catch((e) => console.error("GoLinks: writing the redirect log failed:", e));
  return redirectLogQueue;
}

// Call synchronously at the top level of a background (see observeRedirects).
function startRedirectLog(): void {
  observeRedirects((fact) => {
    const entry = logEntryFor(fact, api.runtime.getURL(""));
    if (entry) appendRedirectLog(entry);
  });
}

// Clearing per-device data: the storage.local keys to remove among the stored
// ones. Always `linkMetrics` and every redirect log day; with `settings` (the
// factory reset) also the page's `helpSort`. `deviceId` (identity) always stays.
function metricsKeysToClear(stored: Record<string, unknown>, settings = false): string[] {
  return Object.keys(stored).filter(
    (key) => key === "linkMetrics" || key.startsWith(REDIRECT_LOG_PREFIX) || (settings && key === "helpSort"),
  );
}

// One storage.local.remove, from a page. It does not wait for the background's
// queues: a hit written while it runs can bring old data back (accepted edge).
async function clearMetrics(settings = false): Promise<void> {
  const keys = metricsKeysToClear(await api.storage.local.get(null), settings);
  if (keys.length > 0) await api.storage.local.remove(keys);
}
