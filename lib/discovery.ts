import type { Founder } from "./model";

export type IntroMetrics = {
  likes: number | null;
  views: number | null;
  observedAt: string;
};
export type Metric = "likes" | "views";
export type DiscoveryFounder = Pick<
  Founder,
  | "handle"
  | "name"
  | "bio"
  | "city"
  | "country"
  | "category"
  | "avatarUrl"
  | "introUrl"
> & {
  coordinates: [number, number] | null;
  introMetrics: IntroMetrics | null;
};

function count(value: unknown): number | null {
  if (typeof value === "string" && /^\d+$/.test(value)) value = Number(value);
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}
export function readIntroMetrics(
  row: Record<string, unknown>,
  observedAt = new Date().toISOString(),
): IntroMetrics | null {
  const publicMetrics =
    row.public_metrics && typeof row.public_metrics === "object"
      ? (row.public_metrics as Record<string, unknown>)
      : {};
  const views =
    row.views && typeof row.views === "object"
      ? (row.views as Record<string, unknown>).count
      : row.views;
  const likes = count(
    row.favorite_count ?? row.like_count ?? publicMetrics.like_count,
  );
  const viewCount = count(
    row.view_count ?? views ?? publicMetrics.impression_count,
  );
  return likes !== null || viewCount !== null
    ? { likes, views: viewCount, observedAt }
    : null;
}
export function rankFounders<
  T extends {
    handle: string;
    introMetrics?: { likes: number | null; views: number | null } | null;
  },
>(founders: T[], metric: Metric): T[] {
  return founders
    .filter((f) => f.introMetrics?.[metric] != null)
    .sort(
      (a, b) =>
        b.introMetrics![metric]! - a.introMetrics![metric]! ||
        a.handle.localeCompare(b.handle),
    );
}
export function filterDiscovery(
  founders: DiscoveryFounder[],
  q: string,
  category: string,
  country: string,
) {
  const needle = q.trim().toLowerCase();
  return founders.filter(
    (f) =>
      (!category || f.category === category) &&
      (!country || f.country === country) &&
      (!needle ||
        [f.name, f.handle, f.bio, f.city, f.country]
          .join(" ")
          .toLowerCase()
          .includes(needle)),
  );
}
