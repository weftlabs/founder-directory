import { discoveryQuery } from "@/lib/discovery";
import { SiteHeader } from "./site-header";
import { DiscoveryBrowser } from "./discovery-browser";
import { loadDiscovery } from "@/lib/discovery-data";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Founder map",
  description: "Find founders around the world, city by city.",
  alternates: { canonical: "/" },
};
export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = discoveryQuery(await searchParams);
  const data = await loadDiscovery(query);
  return (
    <>
      <SiteHeader mapCurrent />
      <DiscoveryBrowser
        key={JSON.stringify([
          query.q,
          query.country,
          query.category,
          query.city,
        ])}
        {...data}
      />
    </>
  );
}
