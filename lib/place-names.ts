export const normalizePlace = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const countryAliases: Record<string, string> = {
  usa: "united states",
  us: "united states",
  "united states of america": "united states",
  uk: "united kingdom",
  "great britain": "united kingdom",
  turkiye: "turkey",
};

export function canonicalCountry(value: string): string {
  const normalized = normalizePlace(value);
  return countryAliases[normalized] ?? normalized;
}
