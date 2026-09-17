import { notFound } from "next/navigation";
import { productCard, productPage, productQuery } from "@/lib/products";
import { ProductsView } from "../products-view";
import { SiteHeader } from "../site-header";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };
const supported = (value: string) => ({
  value,
  state: "supported",
  kind: "publisher_statement",
});
export default async function ProductsPreview({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.DIRECTORY_PREVIEW !== "1") notFound();
  const query = productQuery(await searchParams);
  const cards = Array.from({ length: 27 }, (_, i) =>
    productCard({
      name: supported(`Example ${String(i + 1).padStart(2, "0")}`),
      description: supported(
        i % 2
          ? "A shared workspace for independent designers."
          : "Scheduling tools for small healthcare teams.",
      ),
      domain: supported(i % 2 ? "Design" : "Healthcare"),
      audience: supported(i % 2 ? "Designers" : "Doctors"),
      businessModel: i % 3 ? supported("Subscription") : null,
      stage: i % 3 ? { ...supported("Beta"), kind: "inference" } : null,
      website: i % 3 === 0 ? "javascript:alert(1)" : "https://example.com",
      founders: [`example_${i + 1}`],
    }),
  );
  return (
    <>
      <SiteHeader productsCurrent />
      <ProductsView
        key={JSON.stringify(query)}
        data={productPage(cards, query)}
        query={query}
        base="/products-preview"
        preview="synthetic"
      />
    </>
  );
}
