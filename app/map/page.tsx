import { SiteHeader } from "../site-header";
import { DiscoveryBrowser } from "../discovery-browser";
import { loadDiscovery } from "@/lib/discovery-data";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Founder map",
  description: "Find founders around the world, city by city.",
  alternates: { canonical: "/map" },
};
export default async function MapPage() {
  const data = await loadDiscovery();
  return (
    <>
      <SiteHeader mapCurrent />
      <DiscoveryBrowser {...data} mode="map" />
    </>
  );
}
