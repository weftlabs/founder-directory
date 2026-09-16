import type { Founder } from "./model";

export type IntroMetrics = {
  likes: number | null;
  views: number | null;
  observedAt: string;
};
export type Metric = "likes" | "views";
export type DiscoveryFounder = Pick<
  Founder,
  | "handle"
  | "name"
  | "bio"
  | "city"
  | "country"
  | "category"
  | "avatarUrl"
  | "introUrl"
> & {
  coordinates: [number, number] | null;
  introMetrics: IntroMetrics | null;
};

function count(value: unknown): number | null {
  if (typeof value === "string" && /^\d+$/.test(value)) value = Number(value);
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}
export function readIntroMetrics(
  row: Record<string, unknown>,
  observedAt = new Date().toISOString(),
): IntroMetrics | null {
  const publicMetrics =
    row.public_metrics && typeof row.public_metrics === "object"
      ? (row.public_metrics as Record<string, unknown>)
      : {};
  const views =
    row.views && typeof row.views === "object"
      ? (row.views as Record<string, unknown>).count
      : row.views;
  const likes = count(
    row.favorite_count ?? row.like_count ?? publicMetrics.like_count,
  );
  const viewCount = count(
    row.view_count ?? views ?? publicMetrics.impression_count,
  );
  return likes !== null || viewCount !== null
    ? { likes, views: viewCount, observedAt }
    : null;
}
export function rankFounders<
  T extends {
    handle: string;
    introMetrics?: { likes: number | null; views: number | null } | null;
  },
>(founders: T[], metric: Metric): T[] {
  return founders
    .filter((f) => f.introMetrics?.[metric] != null)
    .sort(
      (a, b) =>
        b.introMetrics![metric]! - a.introMetrics![metric]! ||
        a.handle.localeCompare(b.handle),
    );
}
export function filterDiscovery(
  founders: DiscoveryFounder[],
  q: string,
  category: string,
  country: string,
) {
  const needle = q.trim().toLowerCase();
  return founders.filter(
    (f) =>
      (!category || f.category === category) &&
      (!country || f.country === country) &&
      (!needle ||
        [f.name, f.handle, f.bio, f.city, f.country]
          .join(" ")
          .toLowerCase()
          .includes(needle)),
  );
}

export type MapPlace = {
  city: string;
  country: string;
  coordinates: [number, number];
  count: number;
};
export type DiscoveryQuery = {
  q: string;
  category: string;
  country: string;
  city: string;
  metric: Metric;
  page: number;
};
export type DiscoveryPageInfo = {
  query: DiscoveryQuery;
  total: number;
  globalTotal: number;
  rankedTotal: number;
  mappedTotal: number;
  countries: string[];
  categories: string[];
  places: MapPlace[];
  hasMore: boolean;
};
export const DISCOVERY_PAGE_SIZE = 48;
export function discoveryQuery(
  params: Record<string, string | string[] | undefined>,
): DiscoveryQuery {
  const get = (key: string) =>
    typeof params[key] === "string"
      ? (params[key] as string).slice(0, 200)
      : "";
  const page = Number(get("page"));
  return {
    q: get("q"),
    category: get("category"),
    country: get("country"),
    city: get("city"),
    metric: get("metric") === "views" ? "views" : "likes",
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 10000) : 1,
  };
}
export function discoveryPage(
  founders: DiscoveryFounder[],
  query: DiscoveryQuery,
  mode: "map" | "leaderboard",
) {
  const filtered = filterDiscovery(
    founders,
    query.q,
    query.category,
    query.country,
  ).filter((f) => !query.city || f.city === query.city);
  const ranked = rankFounders(filtered, query.metric);
  const rows = mode === "map" ? filtered : ranked;
  const places = new Map<string, MapPlace>();
  for (const f of filtered) {
    if (!f.coordinates || !f.city || !f.country) continue;
    const key = JSON.stringify([f.city, f.country]);
    const existing = places.get(key);
    if (existing) existing.count++;
    else
      places.set(key, {
        city: f.city,
        country: f.country,
        coordinates: f.coordinates,
        count: 1,
      });
  }
  const offset = (query.page - 1) * DISCOVERY_PAGE_SIZE;
  const serverPage: DiscoveryPageInfo = {
    query,
    total: filtered.length,
    globalTotal: founders.length,
    rankedTotal: ranked.length,
    mappedTotal: [...places.values()].reduce((n, p) => n + p.count, 0),
    countries: [
      ...new Set(
        founders.map((f) => f.country).filter((c): c is string => Boolean(c)),
      ),
    ].sort(),
    categories: [...new Set(founders.map((f) => f.category))].sort(),
    places: mode === "map" ? [...places.values()] : [],
    hasMore: rows.length > offset + DISCOVERY_PAGE_SIZE,
  };
  return {
    founders: rows.slice(offset, offset + DISCOVERY_PAGE_SIZE),
    serverPage,
  };
}
