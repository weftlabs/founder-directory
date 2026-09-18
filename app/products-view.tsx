// Layer: UI. Server-rendered cards and GET filters keep state in shareable URLs.
import Link from "next/link";
import { ProductImage } from "./product-image";
import {
  PRODUCT_CATEGORIES,
  productHref,
  type ProductClaim,
  type ProductPage,
  type ProductQuery,
} from "@/lib/products";
export function Claim({
  claim,
  fallback = "Unknown",
}: {
  claim: ProductClaim;
  fallback?: string;
}) {
  if (!claim.value)
    return (
      <span className="product-unknown">
        {claim.state === "conflict"
          ? "Conflicting sources"
          : claim.state === "stale"
            ? "Out of date"
            : claim.state === "absent"
              ? "Not reported"
              : fallback}
      </span>
    );
  return (
    <>
      {claim.value}
      {claim.kind === "inference" ? (
        <span className="product-inference">Inferred</span>
      ) : null}
    </>
  );
}
export function ProductsView({
  data,
  query,
  base = "/products",
  preview = null,
  unavailable = false,
}: {
  data: ProductPage;
  query: ProductQuery;
  base?: string;
  preview?: "local" | "synthetic" | null;
  unavailable?: boolean;
}) {
  const activeCategory = PRODUCT_CATEGORIES.find(
    (c) => c.id === query.category,
  );
  return (
    <main className="products-page">
      {preview ? (
        <p className="preview-banner" role="note">
          {preview === "local"
            ? "Local preview · saved pilot products · not published"
            : "Design preview · fictional sample products"}
        </p>
      ) : null}
      <section className="products-hero">
        <p className="product-eyebrow">THE THINGS FOUNDERS BUILD</p>
        <h1>
          Small teams.
          <br />
          <em>Real products.</em>
        </h1>
        <p>
          Explore what founders are building, who it helps, and the ideas behind
          it.
        </p>
      </section>
      <div className="products-layout">
        <nav className="product-categories" aria-label="Product categories">
          <h2>Browse categories</h2>
          <Link
            prefetch={false}
            href={productHref(base, { ...query, category: "", page: 1 })}
            aria-current={!query.category ? "true" : undefined}
          >
            All products{" "}
            <span>{data.categories.reduce((sum, c) => sum + c.count, 0)}</span>
          </Link>
          {PRODUCT_CATEGORIES.map((category) => (
            <Link
              key={category.id}
              prefetch={false}
              href={productHref(base, {
                ...query,
                category: category.id,
                page: 1,
              })}
              aria-current={query.category === category.id ? "true" : undefined}
            >
              {category.label}
              <span>
                {data.categories.find((c) => c.id === category.id)?.count ?? 0}
              </span>
            </Link>
          ))}
          <p className="category-note">
            Categories group saved product descriptions. They are not ratings.
          </p>
        </nav>
        <section className="products-results" aria-label="Products">
          <form className="product-search" action={base} role="search">
            <label className="sr-only" htmlFor="product-search">
              Search products
            </label>
            <input
              id="product-search"
              type="search"
              name="q"
              defaultValue={query.q}
              maxLength={160}
              placeholder="Search products, people, or audiences…"
            />
            {query.category ? (
              <input type="hidden" name="category" value={query.category} />
            ) : null}
            <button type="submit">
              Search <span aria-hidden="true">↗</span>
            </button>
          </form>
          <div className="product-results-heading">
            <h2>{activeCategory?.label ?? "All products"}</h2>
            <p data-testid="product-count">
              {data.total} {data.total === 1 ? "product" : "products"}
              {query.q ? ` for “${query.q}”` : ""}
            </p>
          </div>
          {unavailable ? (
            <div className="products-empty" role="status">
              <h3>Products are temporarily unavailable.</h3>
              <p>
                Please try again later. You can still explore the founder
                directory.
              </p>
              <Link href="/directory" prefetch={false}>
                Explore founders ↗
              </Link>
            </div>
          ) : data.products.length === 0 ? (
            <div className="products-empty" role="status">
              <span aria-hidden="true">◇</span>
              <h3>
                {query.q || query.category
                  ? "No products match these filters."
                  : "The next discovery starts here."}
              </h3>
              <p>
                {query.q || query.category
                  ? "Try a different search or browse all products."
                  : "Reviewed product descriptions will appear here as they become available."}
              </p>
              {query.q || query.category ? (
                <Link href={base} prefetch={false}>
                  Clear filters ↗
                </Link>
              ) : (
                <Link href="/directory" prefetch={false}>
                  Meet the founders ↗
                </Link>
              )}
            </div>
          ) : (
            <div className="product-grid">
              {data.products.map((product, index) => (
                <article
                  className="product-card"
                  data-testid="product-card"
                  key={`${product.name.value}-${index}`}
                >
                  <ProductImage
                    name={product.name.value ?? "Product"}
                    imageUrl={product.imageUrl}
                    website={product.website}
                  />
                  <div className="product-card-top">
                    <span className="product-category">
                      {PRODUCT_CATEGORIES.find((c) => c.id === product.category)
                        ?.label ?? "Uncategorized"}
                    </span>
                  </div>
                  <h3>
                    <Claim claim={product.name} fallback="Unnamed product" />
                  </h3>
                  <p className="product-description">
                    <Claim
                      claim={product.description}
                      fallback="Description not yet known"
                    />
                  </p>
                  {product.audience.value ? (
                    <div className="product-audience">
                      <span>Built for</span>
                      <p>
                        <Claim claim={product.audience} />
                      </p>
                    </div>
                  ) : null}
                  <dl className="product-facts">
                    <div>
                      <dt>Business model</dt>
                      <dd>
                        <Claim claim={product.businessModel} />
                      </dd>
                    </div>
                    <div>
                      <dt>Stage</dt>
                      <dd>
                        <Claim claim={product.stage} />
                      </dd>
                    </div>
                  </dl>
                  <div className="product-card-footer">
                    <div className="product-founders">
                      {product.founders.length ? (
                        product.founders.map((handle) =>
                          preview === "synthetic" ? (
                            <span key={handle}>@{handle} · Sample founder</span>
                          ) : (
                            <Link
                              key={handle}
                              href={`/u/${handle}`}
                              prefetch={false}
                            >
                              <span>@{handle}</span>
                              <span className="product-profile-label">
                                View founder →
                              </span>
                            </Link>
                          ),
                        )
                      ) : (
                        <span>Founder unknown</span>
                      )}
                    </div>
                    {product.website ? (
                      <a
                        className="product-visit"
                        href={product.website}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Visit site <span aria-hidden="true">↗</span>
                      </a>
                    ) : (
                      <span className="product-unknown">No website</span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
          {data.pages > 1 ? (
            <nav className="product-pagination" aria-label="Product pages">
              {data.page > 1 ? (
                <Link
                  prefetch={false}
                  href={productHref(base, { ...query, page: data.page - 1 })}
                >
                  ← Previous
                </Link>
              ) : (
                <span />
              )}
              <p>
                Page {data.page} of {data.pages}
              </p>
              {data.page < data.pages ? (
                <Link
                  prefetch={false}
                  href={productHref(base, { ...query, page: data.page + 1 })}
                >
                  Next →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
          <p className="products-evidence-note">
            Descriptions reflect saved sources and may change. Inferences are
            labeled; missing facts stay unknown. Product coverage is still
            growing.
          </p>
        </section>
      </div>
    </main>
  );
}
