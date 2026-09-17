// Layer: domain. Public product display, taxonomy v1 and URL-based pagination.
import { safeHttpUrl } from "./model";
export const PRODUCT_PAGE_SIZE = 12;
export const PRODUCT_TEXT_LIMIT = 2400;
export const PRODUCT_TAXONOMY_VERSION = 1;
// Ordered navigation rules, not quality or business-model labels. Patterns use
// the common JavaScript/PostgreSQL regex subset so SQL and previews agree.
export const PRODUCT_CATEGORIES = [
  {
    id: "health",
    label: "Health",
    pattern: "health|medical|clinic|patient|doctor",
  },
  {
    id: "logistics",
    label: "Logistics",
    pattern: "logistic|shipping|freight|supply chain|delivery",
  },
  {
    id: "marketing",
    label: "Marketing & sales",
    pattern: "marketing|branding|brand strategy|sales|advertising|seo",
  },
  {
    id: "developer",
    label: "Developer tools",
    pattern:
      "developer|devtool|infrastructure|programming|(^|[^a-z])api([^a-z]|$)",
  },
  {
    id: "design",
    label: "Design & creative",
    pattern: "design|creative|video|photograph|music",
  },
  {
    id: "finance",
    label: "Finance",
    pattern: "finance|financial|accounting|payment|banking",
  },
  {
    id: "education",
    label: "Education",
    pattern: "education|learning|teaching|school",
  },
  {
    id: "productivity",
    label: "Productivity",
    pattern: "productivity|project management|workflow|scheduling|notes",
  },
  {
    id: "ai",
    label: "AI & automation",
    pattern: "artificial intelligence|automation|(^|[^a-z])ai([^a-z]|$)|agent",
  },
  {
    id: "consumer",
    label: "Consumer",
    pattern: "consumer|gaming|social network|travel|fitness",
  },
  { id: "uncategorized", label: "Uncategorized", pattern: null },
] as const;
export type ClaimState =
  "supported" | "unknown" | "conflict" | "stale" | "absent";
export type ClaimKind = "self_report" | "publisher_statement" | "inference";
export type ProductClaim = {
  value: string | null;
  state: ClaimState;
  kind: ClaimKind;
};
export type ProductInput = {
  name?: unknown;
  description?: unknown;
  audience?: unknown;
  domain?: unknown;
  productType?: unknown;
  businessModel?: unknown;
  stage?: unknown;
  website?: unknown;
  founders?: unknown;
};
export type ProductCard = {
  name: ProductClaim;
  description: ProductClaim;
  audience: ProductClaim;
  domain: ProductClaim;
  productType: ProductClaim;
  businessModel: ProductClaim;
  stage: ProductClaim;
  category: string;
  website: string | null;
  founders: string[];
};
export type ProductQuery = { q: string; category: string; page: number };
export type ProductPage = {
  products: ProductCard[];
  total: number;
  page: number;
  pages: number;
  categories: { id: string; count: number }[];
};
export function productClaim(input: unknown): ProductClaim {
  const value =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const state = [
    "supported",
    "unknown",
    "conflict",
    "stale",
    "absent",
  ].includes(String(value.state))
    ? (value.state as ClaimState)
    : "unknown";
  const kind = ["self_report", "publisher_statement", "inference"].includes(
    String(value.kind),
  )
    ? (value.kind as ClaimKind)
    : "inference";
  return {
    value:
      state === "supported" && typeof value.value === "string"
        ? Array.from(value.value).slice(0, PRODUCT_TEXT_LIMIT).join("") || null
        : null,
    state,
    kind,
  };
}
export function productCategory(input: ProductInput): string {
  const text = `${productClaim(input.domain).value ?? ""} ${productClaim(input.productType).value ?? ""}`;
  return (
    PRODUCT_CATEGORIES.find(
      ({ pattern }) => pattern && new RegExp(pattern, "i").test(text),
    )?.id ?? "uncategorized"
  );
}
export function productCard(input: ProductInput): ProductCard {
  return {
    name: productClaim(input.name),
    description: productClaim(input.description),
    audience: productClaim(input.audience),
    domain: productClaim(input.domain),
    productType: productClaim(input.productType),
    businessModel: productClaim(input.businessModel),
    stage: productClaim(input.stage),
    category: productCategory(input),
    website:
      typeof input.website === "string" ? safeHttpUrl(input.website) : null,
    founders: Array.isArray(input.founders)
      ? [
          ...new Set(
            input.founders.filter(
              (handle): handle is string =>
                typeof handle === "string" &&
                /^[a-zA-Z0-9_]{1,15}$/.test(handle),
            ),
          ),
        ].sort()
      : [],
  };
}
export function productQuery(
  params: Record<string, string | string[] | undefined>,
): ProductQuery {
  const first = (key: string) =>
    Array.isArray(params[key]) ? (params[key][0] ?? "") : (params[key] ?? "");
  const page = first("page");
  return {
    q: first("q").trim().slice(0, 160),
    category: PRODUCT_CATEGORIES.some((c) => c.id === first("category"))
      ? first("category")
      : "",
    page: /^[0-9]+$/.test(page)
      ? Math.max(1, Math.min(10000, Number(page)))
      : 1,
  };
}
export function productHref(base: string, query: ProductQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.category) params.set("category", query.category);
  if (query.page > 1) params.set("page", String(query.page));
  return `${base}${params.size ? `?${params}` : ""}`;
}
export function productPage(
  cards: ProductCard[],
  query: ProductQuery,
): ProductPage {
  const searched = cards.filter((card) =>
    [
      card.name.value,
      card.description.value,
      card.audience.value,
      ...card.founders,
    ]
      .join(" ")
      .toLowerCase()
      .includes(query.q.toLowerCase()),
  );
  const filtered = searched
    .filter((card) => !query.category || card.category === query.category)
    .sort(
      (a, b) =>
        (a.name.value ?? "").localeCompare(b.name.value ?? "") ||
        JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
  const pages = Math.max(1, Math.ceil(filtered.length / PRODUCT_PAGE_SIZE));
  const page = Math.min(query.page, pages);
  return {
    products: filtered.slice(
      (page - 1) * PRODUCT_PAGE_SIZE,
      page * PRODUCT_PAGE_SIZE,
    ),
    total: filtered.length,
    page,
    pages,
    categories: PRODUCT_CATEGORIES.map((c) => ({
      id: c.id,
      count: searched.filter((p) => p.category === c.id).length,
    })),
  };
}
