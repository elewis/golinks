"use strict";

// Per-device usage metrics for saved go links, shared by both browsers. Needs
// api.js, links.js and redirects.js. The background scripts call startMetrics(); the help
// page loads this file only for the pure helpers and the column formatting.
//
// A hit is one redirect from an http(s)://go/<name> main_frame request to the
// destination of a saved link. Not counted: not-found redirects (to the
// extension's own page), go/help, the bare go/ root, unknown names.
//
// Everything lives in storage.local (per device, not synced) under
// `linkMetrics`: { [lowercase name]: LinkStat }. Stats are kept forever, also
// for a deleted link (a link created again under that name carries on).

// Times are Unix seconds. The history rolls up as it ages: one entry per hit
// for the last 7 days, hourly buckets up to 90 days, daily buckets after that.
// `count` is the exact total whatever the rollup did. A hit is an object so
// that an optional field (a source tag, say) can be added later without a
// migration; old entries simply lack it.
type Hit = { at: number };
type Bucket = { at: number; n: number };
type LinkStat = {
  count: number;
  lastHit?: number;
  lastEdit?: number;
  recent: Hit[];
  hourly: Bucket[];
  daily: Bucket[];
};
type LinkMetrics = Record<string, LinkStat>;

const RECENT_SECONDS = 7 * 86400;
const HOURLY_SECONDS = 90 * 86400;
const HOUR = 3600;
const DAY = 86400;

function emptyStat(): LinkStat {
  return { count: 0, recent: [], hourly: [], daily: [] };
}

function addToBucket(buckets: Bucket[], at: number, n: number): void {
  const bucket = buckets.find((b) => b.at === at);
  if (bucket) bucket.n += n;
  else buckets.push({ at, n });
}

// Moves what has aged out of a tier into the next coarser one, in place.
// A hit older than 7 days becomes part of its hour; an hour that starts before
// 90 days ago becomes part of its (UTC) day.
function rollup(stat: LinkStat, now: number): void {
  const recent: Hit[] = [];
  for (const hit of stat.recent) {
    if (hit.at < now - RECENT_SECONDS) addToBucket(stat.hourly, hit.at - (hit.at % HOUR), 1);
    else recent.push(hit);
  }
  stat.recent = recent;
  const hourly: Bucket[] = [];
  for (const b of stat.hourly) {
    if (b.at < now - HOURLY_SECONDS) addToBucket(stat.daily, b.at - (b.at % DAY), b.n);
    else hourly.push(b);
  }
  stat.hourly = hourly.sort((a, b) => a.at - b.at);
  stat.daily.sort((a, b) => a.at - b.at);
}

// The metrics after one hit on `name` at `now` (a new object; the input is not changed).
function withHit(metrics: LinkMetrics, name: string, now: number): LinkMetrics {
  const stat: LinkStat = structuredClone(metrics[name] ?? emptyStat());
  stat.count += 1;
  stat.lastHit = now;
  stat.recent.push({ at: now });
  rollup(stat, now);
  return { ...metrics, [name]: stat };
}

// The metrics after the link `name` was added or changed at `now`.
function withEdit(metrics: LinkMetrics, name: string, now: number): LinkMetrics {
  const stat: LinkStat = structuredClone(metrics[name] ?? emptyStat());
  stat.lastEdit = now;
  return { ...metrics, [name]: stat };
}

// The name a redirect fact counts for, or null when it is no hit: it went on
// to somewhere other than the extension's own pages (or a scheme upgrade of
// itself), and its name is a saved
// link (in `links`, lowercase keys) right now.
function hitName(fact: RedirectFact, links: Links, extensionBase: string): string | null {
  if (fact.to.startsWith(extensionBase)) return null;
  // A redirect from go/<name> to go/<name> can only be a scheme upgrade
  // (HTTPS-Only, HTTPS upgrades); the redirect to the destination follows and
  // counts. A link to a different go/ name is a real hit.
  const next = redirectFact({ ...fact, url: fact.to, redirectUrl: "" }, fact.time);
  if (next && next.name === fact.name) return null;
  return fact.name !== "" && Object.hasOwn(links, fact.name) ? fact.name : null;
}

// The names whose destination was added or changed from `before` to `after`
// (the stored localLinks, any key case). Removed links are not edits.
function editedNames(before: Links | undefined, after: Links | undefined): string[] {
  const old = mergeLinks({}, before ?? {});
  const now = mergeLinks({}, after ?? {});
  return Object.keys(now).filter((name) => old[name] !== now[name]);
}

// Column text for go/help. Local date and time to the second.
function formatTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatHits(stat: LinkStat | undefined): string {
  return String(stat?.count ?? 0);
}

function formatLastHit(stat: LinkStat | undefined): string {
  return stat?.lastHit === undefined ? "never" : formatTime(stat.lastHit);
}

function formatLastEdit(stat: LinkStat | undefined): string {
  return stat?.lastEdit === undefined ? "—" : formatTime(stat.lastEdit);
}

// Writes go through one promise chain: each task reads the store afresh, so a
// burst of hits and edits loses nothing, and the listeners never wait for it.
let metricsQueue: Promise<unknown> = Promise.resolve();

function updateMetrics(change: (metrics: LinkMetrics) => LinkMetrics): Promise<unknown> {
  metricsQueue = metricsQueue
    .then(async () => {
      const { linkMetrics = {} }: { linkMetrics?: LinkMetrics } = await api.storage.local.get("linkMetrics");
      await api.storage.local.set({ linkMetrics: change(linkMetrics) });
    })
    .catch((e) => console.error("GoLinks: recording metrics failed:", e));
  return metricsQueue;
}

// The stable id of this device: a random UUID in storage.local.deviceId, made
// on first use and never changed (separate from linkMetrics, so the metrics
// keep their shape). Concurrent first calls share one promise, so there is one
// id and one write; a failure is not cached.
let deviceIdPromise: Promise<string> | null = null;

function getDeviceId(): Promise<string> {
  deviceIdPromise ??= (async () => {
    const { deviceId }: { deviceId?: unknown } = await api.storage.local.get("deviceId");
    if (typeof deviceId === "string" && deviceId !== "") return deviceId;
    const id = crypto.randomUUID();
    await api.storage.local.set({ deviceId: id });
    return id;
  })().catch((e) => {
    deviceIdPromise = null;
    throw e;
  });
  return deviceIdPromise;
}

// Register the background listeners (call it synchronously at the top level,
// so a Chrome service worker can be woken by the events):
// - a go/ redirect fact (see redirects.ts) from a saved name is a hit,
// - a changed destination in sync localLinks is an edit.
function startMetrics(): void {
  getDeviceId().catch((e) => console.error("GoLinks: creating the device id failed:", e));

  observeRedirects(async (fact) => {
    const name = hitName(fact, await readLinks(), api.runtime.getURL(""));
    if (name) {
      const now = Math.floor(fact.time / 1000);
      updateMetrics((metrics) => withHit(metrics, name, now));
    }
  });

  api.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== "sync" || !changes.localLinks) return;
    const names = editedNames(changes.localLinks.oldValue as Links | undefined, changes.localLinks.newValue as Links);
    if (names.length === 0) return;
    const now = Math.floor(Date.now() / 1000);
    updateMetrics((metrics) => names.reduce((m, name) => withEdit(m, name, now), metrics));
  });
}
