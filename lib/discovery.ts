import type { Founder } from "./model";
import { canonicalCountry } from "./place-names";

export type DiscoveryFounder = Pick<
  Founder,
  "handle" | "name" | "bio" | "city" | "country" | "category" | "avatarUrl"
> & {
  coordinates: [number, number] | null;
};

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
      (!country ||
        canonicalCountry(f.country ?? "") === canonicalCountry(country)) &&
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
  page: number;
};
export type DiscoveryPageInfo = {
  query: DiscoveryQuery;
  total: number;
  globalTotal: number;
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
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 10000) : 1,
  };
}
export function discoveryPage(
  founders: DiscoveryFounder[],
  query: DiscoveryQuery,
) {
  const candidates = filterDiscovery(
    founders,
    query.q,
    query.category,
    query.country,
  );
  const selectedPlaces = new Set(
    candidates
      .filter((f) => f.city === query.city && f.coordinates)
      .map((f) => JSON.stringify(f.coordinates)),
  );
  const filtered = candidates.filter(
    (f) =>
      !query.city ||
      f.city === query.city ||
      (f.coordinates && selectedPlaces.has(JSON.stringify(f.coordinates))),
  );
  const rows = filtered;
  const places = new Map<string, MapPlace>();
  for (const f of filtered) {
    if (!f.coordinates || !f.city || !f.country) continue;
    const key = JSON.stringify(f.coordinates);
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
    mappedTotal: [...places.values()].reduce((n, p) => n + p.count, 0),
    countries: [
      ...new Set(
        founders.map((f) => f.country).filter((c): c is string => Boolean(c)),
      ),
    ].sort(),
    categories: [...new Set(founders.map((f) => f.category))].sort(),
    places: [...places.values()],
    hasMore: rows.length > offset + DISCOVERY_PAGE_SIZE,
  };
  return {
    founders: rows.slice(offset, offset + DISCOVERY_PAGE_SIZE),
    serverPage,
  };
}
