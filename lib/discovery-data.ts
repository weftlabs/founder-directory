import "./assert-server";
import { listFounders } from "./db";
import { locateFounder } from "./geography";
import { discoveryPage, type DiscoveryQuery } from "./discovery";

export async function loadDiscovery(query: DiscoveryQuery) {
  if (!process.env.DATABASE_URL)
    return { ...discoveryPage([], query), unavailable: false };
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
      coordinates: locateFounder(f),
    }));
    return { ...discoveryPage(founders, query), unavailable: false };
  } catch {
    return { ...discoveryPage([], query), unavailable: true };
  }
}
