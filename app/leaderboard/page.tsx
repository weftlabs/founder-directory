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
export default async function LeaderboardPage() {
  const data = await loadDiscovery();
  return (
    <>
      <SiteHeader leaderboardCurrent />
      <DiscoveryBrowser {...data} mode="leaderboard" />
    </>
  );
}
