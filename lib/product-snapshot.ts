// Development-only display snapshots. Never fall back to a live database.
import "./assert-server";
import { readFile } from "node:fs/promises";
import { safeHttpUrl } from "./model";
import { productCard, type ProductInput } from "./products";
import { FOUNDER_FACETS } from "./typesafe-founder-poc";
type Env = Record<string, string | undefined>;
export async function readProductSnapshot(env: Env) {
  if (
    !env.PRODUCTS_LOCAL_SNAPSHOT ||
    env.NODE_ENV !== "development" ||
    env.VERCEL
  )
    throw new Error("preview_disabled");
  const data = await readFile(env.PRODUCTS_LOCAL_SNAPSHOT, "utf8");
  if (Buffer.byteLength(data) > 1_000_000)
    throw new Error("snapshot_too_large");
  const parsed = JSON.parse(data);
  if (
    parsed?.version !== 1 ||
    !Array.isArray(parsed.products) ||
    parsed.products.length > 200 ||
    parsed.products.some(
      (p: unknown) => !p || typeof p !== "object" || Array.isArray(p),
    )
  )
    throw new Error("invalid_snapshot");
  return parsed as { products: ProductInput[]; profiles?: unknown[] };
}
export async function loadLocalProductFounder(
  handle: string,
  env: Env = process.env,
) {
  if (!/^[a-zA-Z0-9_]{1,15}$/.test(handle)) return null;
  try {
    const snapshot = await readProductSnapshot(env);
    const products = snapshot.products
      .map(productCard)
      .filter((p) =>
        p.founders.some((h) => h.toLowerCase() === handle.toLowerCase()),
      );
    if (!products.length) return null;
    const record = Array.isArray(snapshot.profiles)
      ? (snapshot.profiles.find(
          (p) =>
            p &&
            typeof p === "object" &&
            "handle" in p &&
            typeof p.handle === "string" &&
            p.handle.toLowerCase() === handle.toLowerCase(),
        ) as Record<string, unknown> | undefined)
      : undefined;
    const field = (key: string) =>
      typeof record?.[key] === "string"
        ? (record[key] as string).slice(0, 2400)
        : null;
    return {
      handle: handle.toLowerCase(),
      name: field("name"),
      bio: field("bio"),
      location: field("location"),
      website: safeHttpUrl(field("website")),
      avatarUrl: safeHttpUrl(field("avatarUrl")),
      dna: localFounderDna(record?.dna),
      products,
    };
  } catch {
    return null;
  }
}

type DnaFacetKey = keyof typeof FOUNDER_FACETS;
export type LocalFounderDna = {
  model: string;
  completedAt: string;
  facets: { key: DnaFacetKey; value: string; confidence: number }[];
  facts: { text: string; state: "supported"; sourceIds: string[] }[];
  sources: { id: string; url: string; text: string }[];
};
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= max;
}
function localFounderDna(value: unknown): LocalFounderDna | null {
  const dna = object(value);
  if (
    !dna ||
    !boundedText(dna.model, 80) ||
    !boundedText(dna.completedAt, 40) ||
    !/^\d{4}-\d{2}-\d{2}T/.test(dna.completedAt) ||
    !Number.isFinite(Date.parse(dna.completedAt)) ||
    !Array.isArray(dna.facets) ||
    dna.facets.length !== 4 ||
    !Array.isArray(dna.sources) ||
    !dna.sources.length ||
    dna.sources.length > 6 ||
    !Array.isArray(dna.facts) ||
    dna.facts.length > 12
  )
    return null;
  const facets: LocalFounderDna["facets"] = [];
  for (const value of dna.facets) {
    const f = object(value);
    if (
      !f ||
      typeof f.key !== "string" ||
      !Object.hasOwn(FOUNDER_FACETS, f.key)
    )
      return null;
    const key = f.key as DnaFacetKey;
    if (
      facets.some((f) => f.key === key) ||
      typeof f.value !== "string" ||
      !Object.hasOwn(FOUNDER_FACETS[key], f.value) ||
      typeof f.confidence !== "number" ||
      !Number.isFinite(f.confidence) ||
      f.confidence < 0 ||
      f.confidence > 1
    )
      return null;
    facets.push({ key, value: f.value, confidence: f.confidence });
  }
  const sources: LocalFounderDna["sources"] = [];
  for (const value of dna.sources) {
    const s = object(value);
    const url = safeHttpUrl(typeof s?.url === "string" ? s.url : null);
    if (
      !s ||
      !boundedText(s.id, 120) ||
      !url ||
      url.length > 2000 ||
      !boundedText(s.text, 4000) ||
      sources.some((source) => source.id === s.id)
    )
      return null;
    sources.push({ id: s.id, url, text: s.text });
  }
  const facts: LocalFounderDna["facts"] = [];
  for (const value of dna.facts) {
    const f = object(value);
    if (
      !f ||
      f.state !== "supported" ||
      !boundedText(f.text, 1200) ||
      !Array.isArray(f.sourceIds) ||
      !f.sourceIds.length ||
      f.sourceIds.length > 6 ||
      !f.sourceIds.every(
        (id) =>
          typeof id === "string" && sources.some((source) => source.id === id),
      )
    )
      continue;
    facts.push({
      text: f.text,
      state: "supported",
      sourceIds: [...new Set(f.sourceIds as string[])],
    });
  }
  return {
    model: dna.model,
    completedAt: dna.completedAt,
    facets,
    sources,
    facts,
  };
}
