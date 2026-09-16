import { WeftClient } from "@weft-labs/sdk";

export type Place = { city: string | null; country: string | null };

const OPENROUTER_URL = "https://openrouter.mpp.tempo.xyz/v1/chat/completions";
const OPENROUTER = {
  operationId: "openrouter-chat-completions",
  accessMethodId: "mpp-access-23-0-0",
} as const;

const OVERRIDES: Record<string, Place> = {
  "san francisco bay area": {
    city: "San Francisco",
    country: "United States",
  },
  verona: { city: "Verona", country: "Italy" },
};

function keyOf(raw: string) {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

export function emptyPlace(): Place {
  return { city: null, country: null };
}

export async function normalizePlaces(
  raws: string[],
): Promise<Map<string, Place>> {
  const unique = [
    ...new Set(raws.map((raw) => raw.trim()).filter((raw) => raw.length > 0)),
  ];
  const out = new Map<string, Place>();
  const pending: string[] = [];
  for (const raw of unique) {
    const override = OVERRIDES[keyOf(raw)];
    if (override) out.set(raw, override);
    else pending.push(raw);
  }
  if (pending.length === 0) return out;

  const apiKey = process.env.WEFT_API_KEY;
  if (!apiKey) {
    for (const raw of pending) out.set(raw, emptyPlace());
    return out;
  }

  const client = new WeftClient({ apiKey });
  const response = await client.fetch(
    {
      url: OPENROUTER_URL,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "Map each X location string to {raw, city, country}. city is a city or metro in English. country is a country in English. Slogans, streets, emojis, and non-places get nulls. If only a country or region, city is null. USA/UK/England/CA/IL become United States or United Kingdom. JSON array only.",
          },
          { role: "user", content: JSON.stringify(pending) },
        ],
      }),
      maxCostUsd: "0.002",
      ...OPENROUTER,
    },
    { idempotencyKey: crypto.randomUUID() },
  );
  if (response.status < 200 || response.status >= 300) {
    for (const raw of pending) out.set(raw, emptyPlace());
    return out;
  }
  const parsed: unknown = JSON.parse(
    Buffer.from(response.bodyBase64, "base64").toString("utf8"),
  );
  const content = extractContent(parsed);
  const rows = parseJsonArray(content);
  const byRaw = new Map<string, Place>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const raw = typeof rec.raw === "string" ? rec.raw : null;
    if (!raw) continue;
    byRaw.set(keyOf(raw), {
      city: clean(rec.city),
      country: clean(rec.country),
    });
  }
  for (const raw of pending) {
    out.set(raw, byRaw.get(keyOf(raw)) ?? emptyPlace());
  }
  return out;
}

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function extractContent(parsed: unknown): string {
  if (!parsed || typeof parsed !== "object") return "[]";
  const choices = (parsed as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0]) return "[]";
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  return typeof message?.content === "string" ? message.content : "[]";
}

function parseJsonArray(content: string): unknown[] {
  const start = content.indexOf("[");
  const end = content.lastIndexOf("]");
  if (start < 0 || end < start) return [];
  try {
    const value: unknown = JSON.parse(content.slice(start, end + 1));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
