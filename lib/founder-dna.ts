// Pure public values. No provider, storage, vector, or environment dependencies.
import { safeHttpUrl } from "./model";
import { productCard, PRODUCT_CATEGORIES, type ProductInput } from "./products";
export const FOUNDER_DNA_SCHEMA_VERSION = 1;
export const MAX_FOUNDER_CONNECTIONS = 3;
export const DNA_FACET_CHOICES = {
  venture_domain: [...PRODUCT_CATEGORIES.map((c) => c.id), "unknown"],
  craft: [
    "technical",
    "creative_branding",
    "research",
    "operations",
    "mixed",
    "unknown",
  ],
  building_style: ["publicly_documenting", "explicitly_private", "unknown"],
  founding_role: ["solo", "cofounder", "unknown"],
} as const;
export type DnaFacetKey = keyof typeof DNA_FACET_CHOICES;
export type FounderDnaFacet = {
  key: DnaFacetKey;
  value: string;
  confidence: number;
};
export type FounderDnaSource = {
  id: string;
  label: string;
  kind: "bio" | "post" | "biography" | "product";
  url: string;
  excerpt: string;
};
export type FounderDnaFact = { id: string; text: string; sourceIds: string[] };
export type CheckedFounderPortrait = {
  analysisId: string;
  revision: string;
  recipeVersion: string;
  model: string;
  archetype: {
    title: string;
    kicker: string;
    hook: string;
    summary: string;
    tags: string[];
  };
  roast: { title: string; lines: { text: string; factIds: string[] }[] };
  story: { title: string; before: string; after: string; connection: string };
  shareText: string;
  factIds: string[];
};
export type FounderConnection = {
  id: string;
  relation: "related_work";
  reason: string;
  founder: {
    id: string;
    handle: string;
    name: string;
    avatarUrl: string | null;
    headline: string;
    revision: string;
  };
  sourceIds: string[];
  sources: FounderDnaSource[];
};
export type FounderDnaProfile = {
  id: string;
  handle: string;
  name: string;
  bio: string | null;
  avatarUrl: string | null;
  location: string | null;
  website: string | null;
  releaseId: string;
  revision: string;
  sourceRevision: string;
  analysisId: string;
  facets: FounderDnaFacet[];
  facts: FounderDnaFact[];
  sources: FounderDnaSource[];
  portrait: CheckedFounderPortrait;
  products: ReturnType<typeof productCard>[];
  connections: FounderConnection[];
};
export type FounderDnaResult =
  | { status: "ready"; profile: FounderDnaProfile }
  | { status: "disabled" | "not_found" | "hidden" | "unavailable" };
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_dna_object");
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 2400): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error("invalid_dna_text");
  return value;
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new Error("invalid_dna_list");
  return value;
}
function optional(value: unknown, max = 2400) {
  return value === null || value === undefined ? null : text(value, max);
}
function url(value: unknown): string {
  const result = safeHttpUrl(text(value, 2000));
  if (!result) throw new Error("invalid_dna_url");
  return result;
}
function handle(value: unknown) {
  const result = text(value, 15).toLowerCase();
  if (!/^[a-z0-9_]+$/.test(result)) throw new Error("invalid_dna_handle");
  return result;
}
function ids(value: unknown, allowed: string[], max = 12) {
  const result = list(value, max).map((v) => text(v, 120));
  if (
    !result.length ||
    new Set(result).size !== result.length ||
    result.some((id) => !allowed.includes(id))
  )
    throw new Error("invalid_dna_reference");
  return result;
}
function sources(value: unknown): FounderDnaSource[] {
  const result = list(value, 24).map((v): FounderDnaSource => {
    const s = record(v);
    if (
      s.kind !== "bio" &&
      s.kind !== "post" &&
      s.kind !== "biography" &&
      s.kind !== "product"
    )
      throw new Error("invalid_dna_source");
    return {
      id: text(s.id, 120),
      label: text(s.label, 120),
      kind: s.kind,
      url: url(s.url),
      excerpt: text(s.excerpt, 2400),
    };
  });
  if (new Set(result.map((s) => s.id)).size !== result.length)
    throw new Error("duplicate_dna_source");
  return result;
}
export function parseFounderDnaProfile(value: unknown): FounderDnaProfile {
  const p = record(value),
    publicSources = sources(p.sources),
    sourceIds = publicSources.map((s) => s.id);
  const facts = list(p.facts, 24).map((v) => {
    const f = record(v);
    return {
      id: text(f.id, 120),
      text: text(f.text, 1200),
      sourceIds: ids(f.sourceIds, sourceIds),
    };
  });
  const factIds = facts.map((f) => f.id);
  if (new Set(factIds).size !== facts.length)
    throw new Error("duplicate_dna_fact");
  const facets = list(p.facets, 4).map((v) => {
    const f = record(v);
    if (typeof f.key !== "string" || !Object.hasOwn(DNA_FACET_CHOICES, f.key))
      throw new Error("invalid_dna_facet");
    const key = f.key as DnaFacetKey;
    if (
      !(DNA_FACET_CHOICES[key] as readonly string[]).includes(
        String(f.value),
      ) ||
      typeof f.confidence !== "number" ||
      !Number.isFinite(f.confidence) ||
      f.confidence < 0 ||
      f.confidence > 1
    )
      throw new Error("invalid_dna_facet");
    return { key, value: text(f.value, 80), confidence: f.confidence };
  });
  if (facets.length !== 4 || new Set(facets.map((f) => f.key)).size !== 4)
    throw new Error("missing_dna_facet");
  const portrait = record(p.portrait),
    a = record(portrait.archetype),
    r = record(portrait.roast),
    s = record(portrait.story);
  const checked: CheckedFounderPortrait = {
    analysisId: text(portrait.analysisId, 120),
    revision: text(portrait.revision, 120),
    recipeVersion: text(portrait.recipeVersion, 120),
    model: text(portrait.model, 120),
    archetype: {
      title: text(a.title, 120),
      kicker: text(a.kicker, 120),
      hook: text(a.hook, 240),
      summary: text(a.summary, 600),
      tags: list(a.tags, 5).map((t) => text(t, 80)),
    },
    roast: {
      title: text(r.title, 120),
      lines: list(r.lines, 5).map((v) => {
        const l = record(v);
        return { text: text(l.text, 400), factIds: ids(l.factIds, factIds) };
      }),
    },
    story: {
      title: text(s.title, 120),
      before: text(s.before, 240),
      after: text(s.after, 240),
      connection: text(s.connection, 600),
    },
    shareText: text(portrait.shareText, 1200),
    factIds: ids(portrait.factIds, factIds),
  };
  if (!checked.roast.lines.length) throw new Error("missing_dna_roast");
  const connections = list(p.connections, MAX_FOUNDER_CONNECTIONS).map((v) => {
    const c = record(v),
      f = record(c.founder),
      cs = sources(c.sources);
    if (c.relation !== "related_work") throw new Error("invalid_dna_relation");
    return {
      id: text(c.id, 120),
      relation: "related_work" as const,
      reason: text(c.reason, 400),
      founder: {
        id: text(f.id, 120),
        handle: handle(f.handle),
        name: text(f.name, 200),
        avatarUrl: f.avatarUrl ? url(f.avatarUrl) : null,
        headline: text(f.headline, 240),
        revision: text(f.revision, 120),
      },
      sourceIds: ids(
        c.sourceIds,
        cs.map((s) => s.id),
      ),
      sources: cs,
    };
  });
  if (
    connections.some((c) => c.founder.id === p.id) ||
    new Set(connections.map((c) => c.founder.id)).size !== connections.length
  )
    throw new Error("invalid_dna_neighbours");
  return {
    id: text(p.id, 120),
    handle: handle(p.handle),
    name: text(p.name, 200),
    bio: optional(p.bio),
    avatarUrl: p.avatarUrl ? url(p.avatarUrl) : null,
    location: optional(p.location, 200),
    website: p.website ? url(p.website) : null,
    releaseId: text(p.releaseId, 120),
    revision: text(p.revision, 120),
    sourceRevision: text(p.sourceRevision, 120),
    analysisId: text(p.analysisId, 120),
    facets,
    facts,
    sources: publicSources,
    portrait: checked,
    products: list(p.products, 12).map((v) =>
      productCard(record(v) as ProductInput),
    ),
    connections,
  };
}
