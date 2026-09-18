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
      portrait: localPortrait(record?.portrait),
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

export type LocalPortrait = {
  archetype: {
    title: string;
    kicker: string;
    hook: string;
    summary: string;
    tags: string[];
  };
  roast: { title: string; lines: { text: string; receipt: string }[] };
  story: { title: string; before: string; after: string; connection: string };
  receipts: {
    label: string;
    quote: string;
    source: "bio" | "product";
    url: string;
  }[];
  shareText: string;
};
function localPortrait(value: unknown): LocalPortrait | null {
  const p = object(value);
  const a = object(p?.archetype),
    r = object(p?.roast),
    s = object(p?.story);
  if (
    !p ||
    !a ||
    !r ||
    !s ||
    !boundedText(p.shareText, 1200) ||
    !boundedText(a.title, 120) ||
    !boundedText(a.kicker, 120) ||
    !boundedText(a.hook, 240) ||
    !boundedText(a.summary, 600) ||
    !Array.isArray(a.tags) ||
    !a.tags.length ||
    a.tags.length > 5 ||
    !a.tags.every((t) => boundedText(t, 80)) ||
    !boundedText(r.title, 120) ||
    !Array.isArray(r.lines) ||
    !r.lines.length ||
    r.lines.length > 5 ||
    !boundedText(s.title, 120) ||
    !boundedText(s.before, 240) ||
    !boundedText(s.after, 240) ||
    !boundedText(s.connection, 600) ||
    !Array.isArray(p.receipts) ||
    !p.receipts.length ||
    p.receipts.length > 6
  )
    return null;
  const receipts: LocalPortrait["receipts"] = [];
  for (const item of p.receipts) {
    const receipt = object(item);
    const url = safeHttpUrl(
      typeof receipt?.url === "string" ? receipt.url : null,
    );
    if (
      !receipt ||
      !boundedText(receipt.label, 80) ||
      !boundedText(receipt.quote, 2400) ||
      !url ||
      url.length > 2000 ||
      (receipt.source !== "bio" && receipt.source !== "product") ||
      receipts.some((r) => r.label === receipt.label)
    )
      return null;
    receipts.push({
      label: receipt.label,
      quote: receipt.quote,
      source: receipt.source as "bio" | "product",
      url,
    });
  }
  const lines: LocalPortrait["roast"]["lines"] = [];
  for (const item of r.lines) {
    const line = object(item);
    if (
      !line ||
      !boundedText(line.text, 400) ||
      typeof line.receipt !== "string" ||
      !receipts.some((r) => r.label === line.receipt)
    )
      return null;
    lines.push({ text: line.text, receipt: line.receipt });
  }
  return {
    archetype: {
      title: a.title,
      kicker: a.kicker,
      hook: a.hook,
      summary: a.summary,
      tags: a.tags as string[],
    },
    roast: { title: r.title, lines },
    story: {
      title: s.title,
      before: s.before,
      after: s.after,
      connection: s.connection,
    },
    receipts,
    shareText: p.shareText,
  };
}
export async function loadLocalPortraitFounders(env: Env = process.env) {
  try {
    const snapshot = await readProductSnapshot(env);
    if (!Array.isArray(snapshot.profiles)) return [];
    const handles = [
      ...new Set(
        snapshot.profiles.flatMap((value) => {
          const profile = object(value);
          return typeof profile?.handle === "string" &&
            /^[a-zA-Z0-9_]{1,15}$/.test(profile.handle)
            ? [profile.handle.toLowerCase()]
            : [];
        }),
      ),
    ].slice(0, 12);
    const founders = await Promise.all(
      handles.map((handle) => loadLocalProductFounder(handle, env)),
    );
    return founders.filter(
      (
        founder,
      ): founder is NonNullable<typeof founder> & { portrait: LocalPortrait } =>
        !!founder?.portrait,
    );
  } catch {
    return [];
  }
}
