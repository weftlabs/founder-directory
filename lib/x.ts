import { WeftClient, type FetchResponse } from "@weft-labs/sdk";
import {
  categorize,
  extractGithub,
  extractLinkedin,
  scoreVibe,
  splitLocation,
  type Founder,
} from "./model";

const X_USER_DETAILS_URL = "https://twitter.use.x402atlas.com/user-details";
const X_SEARCH_URL = "https://twitter.use.x402atlas.com/search";
const MAX_COST_USD = "0.01";
const TREND_PHRASE = "I'm a solo founder";
const MAX_NEW_PER_SCAN = 8;

const X_PROFILE = {
  operationId: "bazaar-x402-atlas-183",
  accessMethodId: "bazaar-x402-atlas-183-x402",
} as const;

const X_SEARCH = {
  operationId: "bazaar-x402-atlas-177",
  accessMethodId: "bazaar-x402-atlas-177-x402",
} as const;

function weft() {
  const apiKey = process.env.WEFT_API_KEY;
  if (!apiKey) throw new Error("WEFT_API_KEY is not set");
  return new WeftClient({ apiKey });
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

export type TrendHit = { handle: string; name: string; text: string };

export async function searchIntro(): Promise<TrendHit[]> {
  const client = weft();
  const params = new URLSearchParams({
    phrase: TREND_PHRASE,
    type: "latest",
  });
  const response = await client.fetch(
    {
      url: `${X_SEARCH_URL}?${params.toString()}`,
      method: "GET",
      headers: {},
      maxCostUsd: MAX_COST_USD,
      ...X_SEARCH,
    },
    { idempotencyKey: crypto.randomUUID() },
  );
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Search HTTP ${response.status}`);
  }
  const payload = decodeBody(response);
  const tweets = Array.isArray(payload.tweets)
    ? payload.tweets
    : Array.isArray(payload.data)
      ? payload.data
      : [];
  const seen = new Set<string>();
  const out: TrendHit[] = [];
  for (const item of tweets) {
    const row = asRecord(item);
    if (!row) continue;
    const author = asRecord(row.author) ?? asRecord(row.user);
    const handle =
      asString(author?.screen_name) ?? asString(author?.username);
    const name = asString(author?.name) ?? handle;
    const text = asString(row.text) ?? asString(row.full_text);
    if (!handle || !name || !text) continue;
    const key = handle.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ handle, name, text });
  }
  return out;
}

export async function fetchProfile(
  handle: string,
  introText: string | null,
): Promise<Founder | null> {
  const client = weft();
  const response = await client.fetch(
    {
      url: `${X_USER_DETAILS_URL}?username=${encodeURIComponent(handle)}`,
      method: "GET",
      headers: {},
      maxCostUsd: MAX_COST_USD,
      ...X_PROFILE,
    },
    { idempotencyKey: crypto.randomUUID() },
  );
  if (response.status < 200 || response.status >= 300) return null;
  const payload = decodeBody(response);
  const data = asRecord(payload.data);
  if (!data) return null;
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
  const place = splitLocation(location);
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

export { MAX_NEW_PER_SCAN, TREND_PHRASE };
