import {
  existingHandles,
  loadScanProgress,
  saveScanProgress,
  touchScan,
  upsertFounder,
} from "./db";
import type { Founder } from "./model";
import { emptyPlace, normalizePlaces } from "./place";
import {
  fetchProfile,
  searchIntroPage,
  TREND_PHRASES,
  type TrendHit,
} from "./x";

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
  handle: string;
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
    const handle = typeof row.handle === "string" ? row.handle.trim() : "";
    const text = typeof row.text === "string" ? row.text : "";
    if (!handle || !text) continue;
    const key = handle.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const tweetId =
      typeof row.tweetId === "string" && row.tweetId.length > 0
        ? row.tweetId
        : null;
    out.push({ handle, name: handle, text, tweetId });
  }
  return out;
}

export function serializePendingIntros(hits: TrendHit[]): PendingIntro[] {
  return hits.map((hit) => ({
    handle: hit.handle,
    text: hit.text,
    tweetId: hit.tweetId,
  }));
}

export const SCAN_DEADLINE_MS = 240_000;
export const SCHEDULED_SCAN_PAGES = 5;
export const BULK_SCAN_PAGES = 25;
export const SCHEDULED_MAX_SEARCHES = 8;
export const BULK_MAX_SEARCHES = 16;
export const SCHEDULED_MAX_HYDRATIONS = 15;
export const BULK_MAX_HYDRATIONS = 30;

export type ScanLimits = {
  maxPages: number;
  maxSearches: number;
  maxHydrations: number;
};

export function scanLimits(bulk = false): ScanLimits {
  return bulk
    ? {
        maxPages: BULK_SCAN_PAGES,
        maxSearches: BULK_MAX_SEARCHES,
        maxHydrations: BULK_MAX_HYDRATIONS,
      }
    : {
        maxPages: SCHEDULED_SCAN_PAGES,
        maxSearches: SCHEDULED_MAX_SEARCHES,
        maxHydrations: SCHEDULED_MAX_HYDRATIONS,
      };
}

export type ScanStore = {
  existingHandles(): Promise<Set<string>>;
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
  existingHandles,
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
  let queueIndex = 0;

  async function hydrateNext(hit: TrendHit) {
    hydrations += 1;
    const founder = await hydrate(hit.handle, hit.text, hit.tweetId);
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

  let added = 0;
  for (const founder of hydratedFounders) {
    const place = founder.location
      ? (places.get(founder.location) ?? emptyPlace())
      : emptyPlace();
    founder.city = place.city;
    founder.country = place.country;
    await store.upsertFounder(founder);
    added += 1;
  }

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
