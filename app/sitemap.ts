import type { MetadataRoute } from "next";
import { listFounders } from "@/lib/db";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = [
    ...["/map", "/leaderboard"].map((path) => ({
      url: `${SITE_URL}${path}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    {
      url: SITE_URL,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/about`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    },
  ];

  try {
    const founders = await listFounders();
    return [
      ...staticRoutes,
      ...founders.map((founder) => ({
        url: `${SITE_URL}/u/${founder.handle}`,
        lastModified: founder.updatedAt ? new Date(founder.updatedAt) : now,
        changeFrequency: "weekly" as const,
        priority: 0.8,
      })),
    ];
  } catch {
    return staticRoutes;
  }
}
