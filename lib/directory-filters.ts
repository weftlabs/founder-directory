import type { Founder } from "./model";

export type DirectoryFilters = {
  q: string;
  category: string;
  country: string;
  city: string;
};

export const emptyFilters: DirectoryFilters = {
  q: "",
  category: "",
  country: "",
  city: "",
};

export function readFilters(
  search: string,
  founders: Founder[],
): DirectoryFilters {
  const params = new URLSearchParams(search);
  const filters = { ...emptyFilters };
  for (const key of Object.keys(filters) as (keyof DirectoryFilters)[]) {
    filters[key] = params.get(key) ?? "";
  }
  // A city-only link is unambiguous only when it belongs to one country.
  if (filters.city && !filters.country) {
    const countries = new Set(
      founders.filter((f) => f.city === filters.city).map((f) => f.country),
    );
    if (countries.size === 1) filters.country = [...countries][0] ?? "";
  }
  return filters;
}

export function writeFilters(
  search: string,
  filters: DirectoryFilters,
): string {
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  return params.toString();
}

export function matchesSearch(founder: Founder, query: string): boolean {
  return [
    founder.name,
    founder.handle,
    founder.bio,
    founder.city,
    founder.country,
    founder.location,
    founder.category,
    founder.category === "Unclear" ? "Uncategorized" : "",
  ]
    .join(" ")
    .toLowerCase()
    .includes(query.trim().toLowerCase());
}

export type LocationOption = {
  value: string;
  label: string;
  count: number;
  country?: string;
};

export function locationOptions(
  founders: Founder[],
  filters: DirectoryFilters,
) {
  const pool = founders.filter(
    (f) =>
      matchesSearch(f, filters.q) &&
      (!filters.category || f.category === filters.category),
  );
  const countries = new Map<string, LocationOption>();
  const cities = new Map<string, LocationOption>();
  for (const founder of pool) {
    if (founder.country) {
      const option = countries.get(founder.country) ?? {
        value: founder.country,
        label: founder.country,
        count: 0,
      };
      option.count++;
      countries.set(founder.country, option);
    }
    if (
      founder.city &&
      (!filters.country || founder.country === filters.country)
    ) {
      const key = JSON.stringify([founder.city, founder.country ?? ""]);
      const option = cities.get(key) ?? {
        value: founder.city,
        country: founder.country ?? "",
        label: `${founder.city}, ${founder.country || "Country unknown"}`,
        count: 0,
      };
      option.count++;
      cities.set(key, option);
    }
  }
  const sort = (options: Map<string, LocationOption>) =>
    [...options.values()].sort((a, b) => a.label.localeCompare(b.label));
  return { countries: sort(countries), cities: sort(cities) };
}
