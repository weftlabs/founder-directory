import { existingHandles, touchScan, upsertFounder } from "./db";
import { emptyPlace, normalizePlaces } from "./place";
import {
  fetchProfile,
  searchIntroPages,
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

export const SCHEDULED_SCAN_PAGES = 5;
export const BULK_SCAN_PAGES = 25;

export async function runScan(options?: { maxPages?: number }) {
  const maxPages = options?.maxPages ?? SCHEDULED_SCAN_PAGES;
  const hits = await searchIntroPages(maxPages);
  const known = await existingHandles();
  const fresh = unknownHits(hits, known);
  let added = 0;
  let failed = 0;
  const pending: import("./model").Founder[] = [];
  for (const hit of fresh) {
    const founder = await fetchProfile(hit.handle, hit.text, hit.tweetId);
    if (!founder) {
      failed += 1;
      continue;
    }
    pending.push(founder);
  }
  const places = await normalizePlaces(
    pending
      .map((founder) => founder.location)
      .filter((value): value is string => Boolean(value)),
  );
  for (const founder of pending) {
    const place = founder.location
      ? (places.get(founder.location) ?? emptyPlace())
      : emptyPlace();
    founder.city = place.city;
    founder.country = place.country;
    await upsertFounder(founder);
    added += 1;
  }
  await touchScan();
  return {
    scanned: hits.length,
    added,
    failed,
    pages: maxPages,
    phrases: [...TREND_PHRASES],
  };
}
