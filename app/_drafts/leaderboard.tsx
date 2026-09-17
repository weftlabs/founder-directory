import { discoveryQuery } from "@/lib/discovery";
import { SiteHeader } from "../site-header";
import { DiscoveryBrowser } from "../discovery-browser";
import { loadDiscovery } from "@/lib/discovery-data";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Founder leaderboard",
  description:
    "Discover founders by views and likes on their public X introductions.",
  alternates: { canonical: "/leaderboard" },
};
export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = discoveryQuery(await searchParams);
  const data = await loadDiscovery(query, "leaderboard");
  return (
    <>
      <SiteHeader />
      <DiscoveryBrowser
        key={JSON.stringify(query)}
        {...data}
        mode="leaderboard"
      />
    </>
  );
}
