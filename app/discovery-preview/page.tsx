import { notFound } from "next/navigation";
import { DiscoveryBrowser } from "../discovery-browser";
import { SiteHeader } from "../site-header";
import { locateFounder } from "@/lib/geography";
import type { DiscoveryFounder } from "@/lib/discovery";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };
const examples = [
  [
    "Alex Example",
    "Berlin",
    "Germany",
    "Infra",
    "Building calmer infrastructure for small teams.",
  ],
  [
    "Sam Example",
    "London",
    "United Kingdom",
    "Tools",
    "Open-source tools for people who make things.",
  ],
  [
    "Robin Example",
    "San Francisco",
    "United States",
    "Consumer",
    "A little app for a better everyday.",
  ],
  [
    "Morgan Example",
    "Paris",
    "France",
    "Tools",
    "Making the internet more personal.",
  ],
  [
    "Taylor Example",
    "Tokyo",
    "Japan",
    "Consumer",
    "Independent games. Extraordinary little worlds.",
  ],
  [
    "Casey Example",
    "Austin",
    "United States",
    "Infra",
    "APIs for the next generation of founders.",
  ],
  [
    "Jordan Example",
    "Singapore",
    "Singapore",
    "Tools",
    "A better way to bring your ideas to life.",
  ],
  [
    "Jamie Example",
    "Toronto",
    "Canada",
    "Consumer",
    "Connecting people through shared interests.",
  ],
  [
    "Drew Example",
    "Sydney",
    "Australia",
    "Tools",
    "Creative software for independent minds.",
  ],
  [
    "Charlie Example",
    "Mars",
    "Unknown",
    "Unclear",
    "Working on something new.",
  ],
];
export default async function DiscoveryPreview({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  if (process.env.DIRECTORY_PREVIEW !== "1") notFound();
  const mode =
    (await searchParams).mode === "leaderboard" ? "leaderboard" : "map";
  const founders: DiscoveryFounder[] = examples.map(
    ([name, city, country, category, bio], i) => ({
      name,
      city,
      country,
      category,
      bio,
      handle: `example_${i}`,
      avatarUrl: null,
      introUrl: null,
      coordinates: locateFounder({ city, country }),
      introMetrics:
        i === 9
          ? null
          : {
              likes: (9 - i) * 123,
              views: (i + 1) * 2500,
              observedAt: "2026-09-17T00:00:00Z",
            },
    }),
  );
  return (
    <>
      <SiteHeader
        mapCurrent={mode === "map"}
        leaderboardCurrent={mode === "leaderboard"}
      />
      <p className="preview-banner">
        Design preview · fictional sample profiles and counts
      </p>
      <DiscoveryBrowser founders={founders} mode={mode} />
    </>
  );
}
