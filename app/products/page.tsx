import type { Metadata } from "next";
import { loadProducts } from "@/lib/product-data";
import { productQuery } from "@/lib/products";
import { SiteHeader } from "../site-header";
import { ProductsView } from "../products-view";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Products",
  description:
    "Explore products built by founders, their audiences, and the ideas behind them.",
  alternates: { canonical: "/products" },
};
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = productQuery(await searchParams);
  const data = await loadProducts(query);
  return (
    <>
      <SiteHeader productsCurrent />
      <ProductsView
        key={JSON.stringify(query)}
        data={data}
        query={query}
        preview={data.preview}
        unavailable={data.unavailable}
      />
    </>
  );
}
