import type { Founder } from "./model";
import type { DirectoryFilters, LocationOption } from "./directory-filters";

export const DIRECTORY_PAGE_SIZE = 48;
/** Start the next page this far before the sentinel enters the viewport. */
export const DIRECTORY_PREFETCH_ROOT_MARGIN = "0px 0px 1200px 0px";

export type DirectoryCursor = {
  updatedAt: string;
  handle: string;
};

export type DirectoryPage = {
  founders: Founder[];
  total: number;
  nextCursor: string | null;
  categories: string[];
  countries: LocationOption[];
  cities: LocationOption[];
};

export function emptyDirectoryPage(): DirectoryPage {
  return {
    founders: [],
    total: 0,
    nextCursor: null,
    categories: [],
    countries: [],
    cities: [],
  };
}

export function appendDirectoryPage(
  current: DirectoryPage,
  page: DirectoryPage,
  expectedKey: string,
  currentKey: string,
): DirectoryPage {
  if (currentKey !== expectedKey) return current;
  const seen = new Set(current.founders.map((founder) => founder.handle));
  return {
    ...page,
    founders: [
      ...current.founders,
      ...page.founders.filter((founder) => !seen.has(founder.handle)),
    ],
    total: current.total,
    categories: current.categories,
    countries: current.countries,
    cities: current.cities,
  };
}

function utf8ToBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToUtf8(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad =
    padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodeDirectoryCursor(cursor: DirectoryCursor): string {
  return utf8ToBase64Url(
    JSON.stringify({ u: cursor.updatedAt, h: cursor.handle }),
  );
}

export function decodeDirectoryCursor(value: string): DirectoryCursor | null {
  if (!value) return null;
  try {
    const json = base64UrlToUtf8(value);
    if (!json || json.includes("\u0000")) return null;
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    const record = parsed as { u?: unknown; h?: unknown };
    if (typeof record.u !== "string" || typeof record.h !== "string")
      return null;
    const updatedAt = record.u.trim();
    const handle = record.h.trim();
    if (!updatedAt || !handle) return null;
    if (handle.length > 64 || /[\u0000-\u001f]/.test(handle)) return null;
    const ms = Date.parse(updatedAt);
    if (Number.isNaN(ms)) return null;
    return { updatedAt, handle };
  } catch {
    return null;
  }
}

export function directoryFiltersFromSearchParams(
  params: URLSearchParams,
): DirectoryFilters {
  return {
    q: params.get("q") ?? "",
    category: params.get("category") ?? "",
    country: params.get("country") ?? "",
    city: params.get("city") ?? "",
  };
}
