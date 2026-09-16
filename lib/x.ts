import { WeftError, type FetchResponse } from "@weft-labs/sdk";
import { defaultWeftDependencies, type WeftDependencies } from "./weft";
import { emptyPlace } from "./place";
import { fetchWithRetry } from "./weft-retry";
import {
  categorize,
  extractGithub,
  extractLinkedin,
  parseHandle,
  scoreVibe,
  type Founder,
} from "./model";

const X_USER_DETAILS_URL = "https://twitter.use.x402atlas.com/user-details";
const X_SEARCH_URL = "https://twitter.use.x402atlas.com/search";
const MAX_COST_USD = "0.01";
const TREND_PHRASE = "I'm a solo founder";
const TREND_PHRASES = [
  "I'm a solo founder",
  "I’m a solo founder",
  "Solo founder from",
  "I'm a founder",
  "I'm founder",
  "I’m a founder",
  "indie hacker",
  "I'm a builder",
] as const;

const X_PROFILE = {
  operationId: "bazaar-x402-atlas-183",
  accessMethodId: "bazaar-x402-atlas-183-x402",
} as const;

const X_SEARCH = {
  operationId: "bazaar-x402-atlas-177",
  accessMethodId: "bazaar-x402-atlas-177-x402",
} as const;

function weft(dependencies: WeftDependencies) {
  const apiKey = dependencies.apiKey();
  if (!apiKey) throw new Error("WEFT_API_KEY is not set");
  return dependencies.createClient(apiKey);
}

function decodeBody(response: FetchResponse): Record<string, unknown> {
  const parsed: unknown = JSON.parse(
    Buffer.from(response.bodyBase64, "base64").toString("utf8"),
  );
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid provider JSON");
  }
  return parsed as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export type TrendHit = {
  handle: string;
  name: string;
  text: string;
  tweetId: string | null;
};

export class ProfileUnavailableError extends Error {
  constructor(readonly status: number) {
    super(`Profile provider unavailable (${status})`);
    this.name = "ProfileUnavailableError";
  }
}

const FIRST_PERSON = /\bI(?:['’`]?m| am)\b/i;
const ROLE =
  /\b(?:solo\s+)?founder\b|\bindie hackers?\b|\b(?:indie\s+)?builders?\b/i;

export function isIntro(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t || /^RT @/i.test(t)) return false;
  if (/\bI know a\b/i.test(t)) return false;
  if (
    /\b(?:another|fellow)\s+(?:solo\s+)?(?:founder|builder|indie hacker)/i.test(
      t,
    ) &&
    !FIRST_PERSON.test(t)
  ) {
    return false;
  }
  if (!ROLE.test(t)) return false;
  if (
    /\bI(?:['’`]?m| am)\s+(?:\d+\.?\s*)?(?:a |an )?(?:solo\s+)?(?:founder|builder|indie hacker)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/\b(?:solo founder|indie hacker) from\b/i.test(t)) return true;
  if (/\bI(?:['’`]?m| am)\s+\d+/i.test(t) && /\b(?:solo\s+)?founder\b/i.test(t))
    return true;
  if (
    /\bI(?:['’`]?m| am)\s+\d+/i.test(t) &&
    /\bindie hacker\b/i.test(t) &&
    !/looking to connect with more/i.test(t)
  ) {
    return true;
  }
  return false;
}

export async function searchIntroPage(
  cursor?: string,
  dependencies?: WeftDependencies,
  phrase: string = TREND_PHRASE,
): Promise<{
  hits: TrendHit[];
  cursor: string | null;
}> {
  const client = weft(dependencies ?? defaultWeftDependencies);
  const params = new URLSearchParams({
    phrase,
    type: "latest",
  });
  if (cursor) params.set("cursor", cursor);
  const response = await fetchWithRetry(client, {
    url: `${X_SEARCH_URL}?${params.toString()}`,
    method: "GET",
    headers: {},
    maxCostUsd: MAX_COST_USD,
    ...X_SEARCH,
  });
  if (!response || response.status < 200 || response.status >= 300) {
    return { hits: [], cursor: null };
  }
  let payload: Record<string, unknown>;
  try {
    payload = decodeBody(response);
  } catch {
    return { hits: [], cursor: null };
  }
  const next =
    asString(payload.cursor) ??
    asString(asRecord(payload.data)?.cursor) ??
    null;
  return {
    hits: parseHits(payload).filter((hit) => isIntro(hit.text)),
    cursor: next,
  };
}

export async function searchIntroPages(
  maxPages: number,
  dependencies: WeftDependencies = defaultWeftDependencies,
): Promise<TrendHit[]> {
  const seen = new Set<string>();
  const out: TrendHit[] = [];
  for (const phrase of TREND_PHRASES) {
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const result = await searchIntroPage(cursor, dependencies, phrase);
      for (const hit of result.hits) {
        const key = hit.handle.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(hit);
      }
      // Latest pages are often all RTs. Keep walking while a cursor exists.
      if (!result.cursor || result.cursor === cursor) break;
      cursor = result.cursor;
    }
  }
  return out;
}

export async function searchIntro(): Promise<TrendHit[]> {
  return searchIntroPages(1);
}

function parseHits(payload: Record<string, unknown>): TrendHit[] {
  const tweets = Array.isArray(payload.tweets)
    ? payload.tweets
    : Array.isArray(payload.data)
      ? payload.data
      : [];
  const out: TrendHit[] = [];
  for (const item of tweets) {
    const row = asRecord(item);
    if (!row) continue;
    const author = asRecord(row.author) ?? asRecord(row.user);
    const rawHandle =
      asString(author?.screen_name) ?? asString(author?.username);
    const name = asString(author?.name) ?? rawHandle;
    const text = asString(row.text) ?? asString(row.full_text);
    const rawTweetId =
      asString(row.id_str) ??
      asString(row.id) ??
      (typeof row.id === "number" ? String(row.id) : null);
    if (!rawHandle || !name || !text || !rawTweetId) continue;
    let handle: string;
    try {
      handle = parseHandle(rawHandle);
    } catch {
      continue;
    }
    if (!/^[0-9]{1,25}$/.test(rawTweetId)) continue;
    if (!isIntro(text)) continue;
    out.push({ handle, name, text, tweetId: rawTweetId });
  }
  return out;
}

export async function fetchProfile(
  handle: string,
  introText: string | null,
  tweetId: string | null = null,
  dependencies: WeftDependencies = defaultWeftDependencies,
): Promise<Founder | null> {
  if (!dependencies.apiKey()) return null;
  const client = weft(dependencies);
  let response: FetchResponse | null;
  try {
    response = await fetchWithRetry(
      client,
      {
        url: `${X_USER_DETAILS_URL}?username=${encodeURIComponent(handle)}`,
        method: "GET",
        headers: {},
        maxCostUsd: MAX_COST_USD,
        ...X_PROFILE,
      },
      dependencies.sleep,
      {
        attempts: 1,
        returnLastResponse: true,
        throwLastTransientError: true,
      },
    );
  } catch (error) {
    if (error instanceof WeftError && [502, 504].includes(error.status)) {
      throw new ProfileUnavailableError(error.status);
    }
    return null;
  }
  if (response && [502, 504].includes(response.status)) {
    throw new ProfileUnavailableError(response.status);
  }
  if (!response || response.status < 200 || response.status >= 300) return null;
  let payload: Record<string, unknown>;
  try {
    payload = decodeBody(response);
  } catch {
    return null;
  }
  const data = asRecord(payload.data);
  if (!data || asRecord(data.privacy)?.protected) return null;
  const core = asRecord(data.core);
  const name = asString(core?.name);
  const screen = asString(core?.screen_name) ?? handle;
  if (!name) return null;
  const bioBlock = asRecord(data.profile_bio);
  const bio = asString(bioBlock?.description);
  const website =
    firstExpandedUrl(bioBlock) ?? asString(asRecord(data.website)?.url);
  const blob = [bio, website, introText].filter(Boolean).join("\n");
  const github = extractGithub(blob);
  const linkedin = extractLinkedin(blob);
  const professional = firstProfessional(data);
  const location = asString(asRecord(data.location)?.location);
  // Raw X locations are not validated places. runScan normalizes them.
  const place = emptyPlace();
  const protectedAccount = Boolean(asRecord(data.privacy)?.protected);
  const tweets = asNumber(asRecord(data.tweet_counts)?.tweets);
  const avatar = enlargeAvatar(asString(asRecord(data.avatar)?.image_url));
  const vibe = scoreVibe({
    bio,
    website,
    github,
    professional,
    protected: protectedAccount,
    tweets,
  });
  return {
    handle: screen,
    name,
    bio,
    website,
    github,
    linkedin,
    city: place.city,
    country: place.country,
    location,
    avatarUrl: avatar,
    category: categorize({ bio, website, github, professional }),
    vibe,
    introText,
    introUrl: tweetId ? `https://x.com/${screen}/status/${tweetId}` : null,
    updatedAt: new Date().toISOString(),
  };
}

function firstExpandedUrl(
  bioBlock: Record<string, unknown> | null,
): string | null {
  const entities = asRecord(bioBlock?.entities);
  const urlBlock = asRecord(entities?.url);
  const urls = urlBlock?.urls;
  if (!Array.isArray(urls)) return null;
  for (const item of urls) {
    const expanded = asString(asRecord(item)?.expanded_url);
    if (expanded) return expanded;
  }
  return null;
}

function firstProfessional(data: Record<string, unknown>): string | null {
  const professional = asRecord(data.professional);
  const category = professional?.category;
  if (!Array.isArray(category)) {
    return asString(professional?.professional_type);
  }
  for (const item of category) {
    const name = asString(asRecord(item)?.name);
    if (name) return name;
  }
  return asString(professional?.professional_type);
}

function enlargeAvatar(url: string | null): string | null {
  if (!url) return null;
  return url.replace(/_normal(\.[a-z0-9]+)$/i, "_400x400$1");
}

export { TREND_PHRASE, TREND_PHRASES };
