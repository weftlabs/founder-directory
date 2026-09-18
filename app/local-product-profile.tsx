import Link from "next/link";
import { Claim } from "./products-view";
import { SiteHeader } from "./site-header";
import { ProductImage } from "./product-image";
import type { loadLocalProductFounder } from "@/lib/product-snapshot";
export function LocalProductProfile({
  founder,
}: {
  founder: NonNullable<Awaited<ReturnType<typeof loadLocalProductFounder>>>;
}) {
  return (
    <>
      <SiteHeader />
      <main className="profile">
        <p className="preview-banner" role="note">
          Local preview · saved founder profile · not published
        </p>
        <Link className="back" href="/products">
          ← Products
        </Link>
        <h1>{founder.name ?? `@${founder.handle}`}</h1>
        <p className="handle">
          @{founder.handle}
          {founder.location ? ` · ${founder.location}` : ""}
        </p>
        {founder.bio ? <p className="bio">{founder.bio}</p> : null}
        <section className="panel">
          <h2>Products</h2>
          {founder.products.map((product, index) => (
            <article className="local-founder-product" key={index}>
              <ProductImage
                name={product.name.value ?? "Product"}
                imageUrl={product.imageUrl}
                website={product.website}
              />
              <h3>
                <Claim claim={product.name} fallback="Unnamed product" />
              </h3>
              <p>
                <Claim
                  claim={product.description}
                  fallback="Description not yet known"
                />
              </p>
              {product.website ? (
                <a href={product.website} target="_blank" rel="noreferrer">
                  Visit site ↗
                </a>
              ) : null}
            </article>
          ))}
        </section>
        <section className="panel">
          <h2>Public links</h2>
          <a
            href={`https://x.com/${founder.handle}`}
            target="_blank"
            rel="noreferrer"
          >
            View @{founder.handle} on X ↗
          </a>
        </section>
      </main>
    </>
  );
}
