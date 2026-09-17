import "./assert-server";
import cities from "./data/cities.json";
import { canonicalCountry, normalizePlace as normalize } from "./place-names";
const cityAliases: Record<string, string> = {
  "new york|united states": "new york city",
  "nyc|united states": "new york city",
  "san francisco bay area|united states": "san francisco",
};
const places = new Map<string, [number, number] | null>();
for (const entry of cities) {
  const [name, ascii, country, lat, lng] = entry as [
    string,
    string,
    string,
    number,
    number,
  ];
  for (const city of new Set([normalize(name), normalize(ascii)])) {
    const key = `${city}|${normalize(country)}`;
    const previous = places.get(key);
    if (previous === undefined) places.set(key, [lng, lat]);
    else if (
      previous &&
      (Math.abs(previous[0] - lng) > 0.05 || Math.abs(previous[1] - lat) > 0.05)
    )
      places.set(key, null);
  }
}
export function locateFounder({
  city,
  country,
}: {
  city: string | null;
  country: string | null;
}): [number, number] | null {
  if (!city || !country) return null;
  const normalized = canonicalCountry(country);
  const cityKey =
    cityAliases[`${normalize(city)}|${normalized}`] ?? normalize(city);
  return places.get(`${cityKey}|${normalized}`) ?? null;
}
