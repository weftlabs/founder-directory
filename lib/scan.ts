import { existingHandles, touchScan, upsertFounder } from "./db";
import { emptyPlace, normalizePlaces } from "./place";
import { fetchProfile, MAX_NEW_PER_SCAN, searchIntroPages, TREND_PHRASES } from "./x";

export async function runScan(options?: {
  maxPages?: number;
  maxNew?: number;
}) {
  const maxPages = options?.maxPages ?? 1;
  const maxNew = options?.maxNew ?? MAX_NEW_PER_SCAN;
  const hits = await searchIntroPages(maxPages);
  const known = await existingHandles();
  const fresh = hits
    .filter((hit) => !known.has(hit.handle.toLowerCase()))
    .slice(0, maxNew);
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
