import { existingHandles, touchScan, upsertFounder } from "./db";
import { fetchProfile, MAX_NEW_PER_SCAN, searchIntro } from "./x";

export async function runScan() {
  const hits = await searchIntro();
  const known = await existingHandles();
  const fresh = hits.filter(
    (hit) => !known.has(hit.handle.toLowerCase()),
  ).slice(0, MAX_NEW_PER_SCAN);
  let added = 0;
  for (const hit of fresh) {
    const founder = await fetchProfile(hit.handle, hit.text);
    if (!founder) continue;
    await upsertFounder(founder);
    added += 1;
  }
  await touchScan();
  return { scanned: hits.length, added, phrase: "I'm a solo founder" };
}
