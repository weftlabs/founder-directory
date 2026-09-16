import {
  existingHandles,
  saveIntroMetrics,
  insertFounderIfAbsent,
  loadScanProgress,
  saveScanProgress,
  touchScan,
  upsertFounder,
} from "./db";
import { parseHandle, type Founder } from "./model";
import { emptyPlace, normalizePlaces } from "./place";
import {
  fetchProfile,
  ProfileUnavailableError,
  searchIntroPage,
  TREND_PHRASES,
  type TrendHit,
} from "./x";

export function founderFromIntro(hit: TrendHit): Founder {
  if (!hit.tweetId || !/^[0-9]{1,25}$/.test(hit.tweetId)) {
    throw new TypeError("A public source tweet is required");
  }
  return {
    ...(hit.introMetrics ? { introMetrics: hit.introMetrics } : {}),
    handle: hit.handle,
    name: hit.name,
    bio: null,
    website: null,
    github: null,
    linkedin: null,
    city: null,
    country: null,
    location: null,
    avatarUrl: null,
    category: "Unclear",
    vibe: {
      score: 40,
      label: "Builder",
      signals: [
        { id: "language", hit: true, text: "Intro talks like a founder" },
      ],
    },
    introText: hit.text,
    introUrl: `https://x.com/${hit.handle}/status/${hit.tweetId}`,
    updatedAt: new Date().toISOString(),
  };
}

export function unknownHits(hits: TrendHit[], known: Set<string>): TrendHit[] {
  const seen = new Set<string>();
  const out: TrendHit[] = [];
  for (const hit of hits) {
    const key = hit.handle.toLowerCase();
    if (known.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

export type ScanCursorMap = Record<string, string | null>;

export type PendingIntro = {
  introMetrics?: TrendHit["introMetrics"];
  handle: string;
  name: string;
  text: string;
  tweetId: string | null;
};

export function parseCursors(value: unknown): ScanCursorMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: ScanCursorMap = {};
  for (const [phrase, cursor] of Object.entries(value)) {
    if (typeof cursor === "string" && cursor.length > 0) out[phrase] = cursor;
    else if (cursor === null) out[phrase] = null;
  }
  return out;
}

export function parsePendingIntros(value: unknown): TrendHit[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: TrendHit[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const rawHandle = typeof row.handle === "string" ? row.handle : "";
    let handle: string;
    try {
      handle = parseHandle(rawHandle);
    } catch {
      continue;
    }
    const name = typeof row.name === "string" ? row.name.trim() : handle;
    const text = typeof row.text === "string" ? row.text : "";
    if (!handle || !name || !text) continue;
    const key = handle.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const tweetId =
      typeof row.tweetId === "string" && row.tweetId.length > 0
        ? row.tweetId
        : null;
    if (tweetId && !/^[0-9]{1,25}$/.test(tweetId)) continue;
    const m = row.introMetrics as TrendHit["introMetrics"];
    const validMetrics =
      m &&
      typeof m.observedAt === "string" &&
      Number.isFinite(Date.parse(m.observedAt)) &&
      [m.likes, m.views].every(
        (v) =>
          v === null ||
          (typeof v === "number" && Number.isSafeInteger(v) && v >= 0),
      );
    out.push({
      handle,
      name,
      text,
      tweetId,
      ...(validMetrics ? { introMetrics: m } : {}),
    });
  }
  return out;
}

export function serializePendingIntros(hits: TrendHit[]): PendingIntro[] {
  return hits.map((hit) => ({
    ...(hit.introMetrics ? { introMetrics: hit.introMetrics } : {}),
    handle: hit.handle,
    name: hit.name,
    text: hit.text,
    tweetId: hit.tweetId,
  }));
}

export const SCAN_DEADLINE_MS = 240_000;
export const DISCOVER_DEADLINE_MS = 90_000;
export const HYDRATE_DEADLINE_MS = 780_000;
export const SCHEDULED_SCAN_PAGES = 5;
export const BULK_SCAN_PAGES = 25;
export const SCHEDULED_MAX_SEARCHES = 8;
export const BULK_MAX_SEARCHES = 16;
export const SCHEDULED_MAX_HYDRATIONS = 15;
export const BULK_MAX_HYDRATIONS = 30;
export const HYDRATE_MAX_HYDRATIONS = 50;

export type ScanLimits = {
  maxPages: number;
  maxSearches: number;
  maxHydrations: number;
};

export type ScanKind = "scheduled" | "bulk" | "discover" | "hydrate";

export function scanLimits(kind: ScanKind | boolean = "scheduled"): ScanLimits {
  if (kind === true || kind === "bulk") {
    return {
      maxPages: BULK_SCAN_PAGES,
      maxSearches: BULK_MAX_SEARCHES,
      maxHydrations: BULK_MAX_HYDRATIONS,
    };
  }
  if (kind === "discover") {
    return {
      maxPages: SCHEDULED_SCAN_PAGES,
      maxSearches: SCHEDULED_MAX_SEARCHES,
      maxHydrations: 0,
    };
  }
  if (kind === "hydrate") {
    return {
      maxPages: SCHEDULED_SCAN_PAGES,
      maxSearches: 0,
      maxHydrations: HYDRATE_MAX_HYDRATIONS,
    };
  }
  return {
    maxPages: SCHEDULED_SCAN_PAGES,
    maxSearches: SCHEDULED_MAX_SEARCHES,
    maxHydrations: SCHEDULED_MAX_HYDRATIONS,
  };
}

export function scanDeadlineMs(kind: ScanKind = "scheduled"): number {
  if (kind === "hydrate") return HYDRATE_DEADLINE_MS;
  if (kind === "discover") return DISCOVER_DEADLINE_MS;
  return SCAN_DEADLINE_MS;
}

export type ScanStore = {
  saveIntroMetrics?(hits: TrendHit[]): Promise<void>;
  existingHandles(): Promise<Set<string>>;
  insertFounderIfAbsent(founder: Founder): Promise<boolean>;
  upsertFounder(founder: Founder): Promise<void>;
  touchScan(): Promise<void>;
  loadProgress(): Promise<{ cursors: ScanCursorMap; pending: TrendHit[] }>;
  saveProgress(progress: {
    cursors: ScanCursorMap;
    pending: TrendHit[];
  }): Promise<void>;
};

export type ScanDependencies = {
  now?: () => number;
  deadlineMs?: number;
  store?: ScanStore;
  searchIntroPage?: (
    cursor: string | undefined,
    phrase: string,
  ) => Promise<{ hits: TrendHit[]; cursor: string | null }>;
  fetchProfile?: (
    handle: string,
    introText: string | null,
    tweetId: string | null,
  ) => Promise<Founder | null>;
  normalizePlaces?: typeof normalizePlaces;
};

const defaultStore: ScanStore = {
  saveIntroMetrics,
  existingHandles,
  insertFounderIfAbsent,
  upsertFounder,
  touchScan,
  async loadProgress() {
    const raw = await loadScanProgress();
    return {
      cursors: parseCursors(raw.searchCursors),
      pending: parsePendingIntros(raw.pendingIntros),
    };
  },
  async saveProgress(progress) {
    await saveScanProgress({
      searchCursors: progress.cursors,
      pendingIntros: serializePendingIntros(progress.pending),
    });
  },
};

export async function materializePendingIntros(
  store: ScanStore = defaultStore,
): Promise<{ added: number; skipped: number }> {
  const progress = await store.loadProgress();
  const known = await store.existingHandles();
  let added = 0;
  let skipped = 0;
  for (const hit of unknownHits(progress.pending, known)) {
    if (!hit.tweetId || !/^[0-9]{1,25}$/.test(hit.tweetId)) {
      skipped += 1;
      continue;
    }
    const inserted = await store.insertFounderIfAbsent(founderFromIntro(hit));
    known.add(hit.handle.toLowerCase());
    if (inserted) added += 1;
  }
  await store.saveIntroMetrics?.(progress.pending);
  await store.touchScan();
  return { added, skipped };
}

export type ScanResult = {
  scanned: number;
  added: number;
  failed: number;
  pages: number;
  phrases: string[];
  searches: number;
  hydrations: number;
  pending: number;
  stopped: "deadline" | "search-cap" | "hydration-cap" | "complete";
};

export async function runScan(
  options?: Partial<ScanLimits> & ScanDependencies,
): Promise<ScanResult> {
  const limits = {
    ...scanLimits(false),
    ...options,
  };
  const now = options?.now ?? Date.now;
  const deadline = now() + (options?.deadlineMs ?? SCAN_DEADLINE_MS);
  const store = options?.store ?? defaultStore;
  const searchPage =
    options?.searchIntroPage ??
    ((cursor, phrase) => searchIntroPage(cursor, undefined, phrase));
  const hydrate =
    options?.fetchProfile ??
    ((handle, introText, tweetId) => fetchProfile(handle, introText, tweetId));
  const placesOf = options?.normalizePlaces ?? normalizePlaces;
  const withinBudget = () => now() < deadline;

  const progress = await store.loadProgress();
  const cursors: ScanCursorMap = { ...progress.cursors };
  const known = await store.existingHandles();
  const discovered: TrendHit[] = [];
  let searches = 0;
  let stopped: ScanResult["stopped"] = "complete";

  const queued = unknownHits(progress.pending, known);
  const hydratedFounders: Founder[] = [];
  let hydrations = 0;
  let failed = 0;
  let added = 0;
  let queueIndex = 0;

  async function hydrateNext(hit: TrendHit) {
    hydrations += 1;
    let founder: Founder | null;
    try {
      founder = await hydrate(hit.handle, hit.text, hit.tweetId);
    } catch (error) {
      if (!(error instanceof ProfileUnavailableError)) throw error;
      failed += 1;
      if (!hit.tweetId || !/^[0-9]{1,25}$/.test(hit.tweetId)) return;
      // The search result is the public source of truth for this basic row.
      // Persist it before any later fallible work so this paid lookup is never replayed.
      founder = founderFromIntro(hit);
      const inserted = await store.insertFounderIfAbsent(founder);
      known.add(hit.handle.toLowerCase());
      if (inserted) added += 1;
      return;
    }
    if (!founder) {
      failed += 1;
      return;
    }
    hydratedFounders.push(founder);
    known.add(hit.handle.toLowerCase());
  }

  while (queueIndex < queued.length) {
    if (!withinBudget()) {
      stopped = "deadline";
      break;
    }
    if (hydrations >= limits.maxHydrations) {
      stopped = "hydration-cap";
      break;
    }
    await hydrateNext(queued[queueIndex]);
    queueIndex += 1;
  }

  const pagesThisTick = new Map<string, number>();
  const exhausted = new Set<string>();
  let searchProgress = true;
  while (searchProgress && searches < limits.maxSearches && withinBudget()) {
    searchProgress = false;
    for (const phrase of TREND_PHRASES) {
      if (searches >= limits.maxSearches) {
        if (stopped === "complete") stopped = "search-cap";
        break;
      }
      if (!withinBudget()) {
        stopped = "deadline";
        break;
      }
      if (exhausted.has(phrase)) continue;
      const used = pagesThisTick.get(phrase) ?? 0;
      if (used >= limits.maxPages) continue;
      const cursor = cursors[phrase] || undefined;
      const result = await searchPage(cursor, phrase);
      searches += 1;
      pagesThisTick.set(phrase, used + 1);
      searchProgress = true;
      for (const hit of result.hits) discovered.push(hit);
      if (!result.cursor || result.cursor === cursor) {
        cursors[phrase] = null;
        exhausted.add(phrase);
      } else {
        cursors[phrase] = result.cursor;
      }
    }
  }
  if (stopped === "complete" && searches >= limits.maxSearches) {
    stopped = "search-cap";
  }
  if (stopped === "complete" && !withinBudget()) stopped = "deadline";

  const fresh = unknownHits(discovered, known);
  let freshIndex = 0;
  while (freshIndex < fresh.length) {
    if (!withinBudget()) {
      stopped = "deadline";
      break;
    }
    if (hydrations >= limits.maxHydrations) {
      if (stopped === "complete" || stopped === "search-cap") {
        stopped = "hydration-cap";
      }
      break;
    }
    await hydrateNext(fresh[freshIndex]);
    freshIndex += 1;
  }

  const leftover = unknownHits(
    [...queued.slice(queueIndex), ...fresh.slice(freshIndex)],
    known,
  );

  let places = new Map<string, ReturnType<typeof emptyPlace>>();
  if (withinBudget()) {
    places = await placesOf(
      hydratedFounders
        .map((founder) => founder.location)
        .filter((value): value is string => Boolean(value)),
    );
  } else {
    stopped = "deadline";
  }

  for (const founder of hydratedFounders) {
    const place = founder.location
      ? (places.get(founder.location) ?? emptyPlace())
      : emptyPlace();
    founder.city = place.city;
    founder.country = place.country;
    await store.upsertFounder(founder);
    added += 1;
  }

  await store.saveIntroMetrics?.([...queued, ...discovered]);
  await store.saveProgress({ cursors, pending: leftover });
  await store.touchScan();

  const scanned = queued.length + unknownHits(discovered, new Set()).length;
  return {
    scanned,
    added,
    failed,
    pages: limits.maxPages,
    phrases: [...TREND_PHRASES],
    searches,
    hydrations,
    pending: leftover.length,
    stopped:
      leftover.length > 0 && stopped === "complete" ? "hydration-cap" : stopped,
  };
}
