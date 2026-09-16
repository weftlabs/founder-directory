import "./assert-server";
import { listFounders } from "./db";
import { locateFounder } from "./geography";
import type { DiscoveryFounder } from "./discovery";

export async function loadDiscovery(): Promise<{
  founders: DiscoveryFounder[];
  unavailable: boolean;
}> {
  if (!process.env.DATABASE_URL) return { founders: [], unavailable: false };
  try {
    const rows = await listFounders();
    return {
      founders: rows.map((f) => ({
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
      })),
      unavailable: false,
    };
  } catch {
    return { founders: [], unavailable: true };
  }
}
