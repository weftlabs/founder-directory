import "./assert-server";
import { listFounders } from "./db";
import { locateFounder } from "./geography";
import { discoveryPage, type DiscoveryQuery } from "./discovery";

export async function loadDiscovery(
  query: DiscoveryQuery,
  mode: "map" | "leaderboard",
) {
  if (!process.env.DATABASE_URL)
    return { ...discoveryPage([], query, mode), unavailable: false };
  try {
    const rows = await listFounders();
    const founders = rows.map((f) => ({
      handle: f.handle,
      name: f.name,
      bio: f.bio,
      city: f.city,
      country: f.country,
      category: f.category,
      avatarUrl: f.avatarUrl,
      introUrl: f.introUrl,
      introMetrics: f.introMetrics ?? null,
      coordinates: locateFounder(f),
    }));
    return { ...discoveryPage(founders, query, mode), unavailable: false };
  } catch {
    return { ...discoveryPage([], query, mode), unavailable: true };
  }
}
