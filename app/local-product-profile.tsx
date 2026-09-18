import Link from "next/link";
import { Claim } from "./products-view";
import { SiteHeader } from "./site-header";
import { ProductImage } from "./product-image";
import { CopyPortrait } from "./dna-lab/copy-portrait";
import { PRODUCT_CATEGORIES } from "@/lib/products";
import type {
  LocalFounderDna,
  loadLocalProductFounder,
} from "@/lib/product-snapshot";
export function LocalProductProfile({
  founder,
}: {
  founder: NonNullable<Awaited<ReturnType<typeof loadLocalProductFounder>>>;
}) {
  return (
    <>
      <SiteHeader />
      <main
        className={founder.portrait ? "profile profile-portrait" : "profile"}
      >
        <p className="profile-local-note" role="note">
          Local preview
        </p>
        <Link className="back" href="/products">
          ← Products
        </Link>
        <div
          className={
            founder.avatarUrl ? "hero-row" : "hero-row hero-row-no-avatar"
          }
        >
          {founder.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={founder.avatarUrl}
              alt=""
              width={96}
              height={96}
              referrerPolicy="no-referrer"
            />
          ) : null}
          <div>
            <h1>{founder.name ?? `@${founder.handle}`}</h1>
            <p className="handle">
              @{founder.handle}
              {founder.location ? ` · ${founder.location}` : ""}
            </p>
          </div>
        </div>
        {founder.bio ? <p className="bio">{founder.bio}</p> : null}
        {founder.portrait ? (
          <>
            <section className="profile-dna-hero">
              <div className="profile-dna-mark" aria-hidden="true">
                ✳
              </div>
              <p className="profile-dna-eyebrow">Founder DNA</p>
              <h2>{founder.portrait.archetype.title}</h2>
              <p className="profile-dna-hook">
                {founder.portrait.archetype.hook}
              </p>
              <div className="portrait-tags">
                {founder.portrait.archetype.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <p className="profile-dna-summary">
                {founder.portrait.archetype.summary}
              </p>
            </section>
            <section className="profile-dna-connection">
              <p className="profile-dna-eyebrow">The connection</p>
              <h2>{founder.portrait.story.title}</h2>
              <p>{founder.portrait.story.connection}</p>
            </section>
            <section className="profile-dna-roast">
              <p className="profile-dna-eyebrow">The friendly roast</p>
              <h2>{founder.portrait.roast.title}</h2>
              <ul>
                {founder.portrait.roast.lines.map((line, index) => (
                  <li key={index}>{line.text}</li>
                ))}
              </ul>
            </section>
          </>
        ) : founder.dna ? (
          <FounderDna dna={founder.dna} />
        ) : null}
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
        {founder.portrait ? (
          <>
            <details className="profile-why">
              <summary>
                Why this fits <span>See the sources behind the portrait</span>
              </summary>
              <p className="founder-dna-note">
                The portrait is an editorial reading of saved public sources.
                The jokes are interpretations, not new facts. Model
                classifications are shown separately below.
              </p>
              <div className="portrait-receipt-grid">
                {founder.portrait.receipts.map((receipt) => (
                  <article key={receipt.label}>
                    <span>
                      {receipt.source === "bio"
                        ? "Saved bio"
                        : receipt.source === "post"
                          ? "Saved post"
                          : receipt.source === "biography"
                            ? "Official bio"
                            : "Saved product summary"}
                    </span>
                    <h3>{receipt.label}</h3>
                    <blockquote>
                      {receipt.source === "product"
                        ? receipt.quote
                        : `“${receipt.quote}”`}
                    </blockquote>
                    <a href={receipt.url} target="_blank" rel="noreferrer">
                      View source ↗
                    </a>
                  </article>
                ))}
              </div>
              {founder.dna ? <FounderDna dna={founder.dna} /> : null}
            </details>
            <section className="profile-share">
              <h2>Share your Founder DNA</h2>
              <CopyPortrait text={founder.portrait.shareText} />
            </section>
          </>
        ) : null}
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

const facetLabels = {
  venture_domain: "Venture domain",
  craft: "Current craft",
  building_style: "Building style",
  founding_role: "Founding role",
};
const valueLabels: Record<string, string> = {
  ...Object.fromEntries(
    PRODUCT_CATEGORIES.map((category) => [category.id, category.label]),
  ),
  unknown: "Not yet known",
  technical: "Technical",
  creative_branding: "Creative & branding",
  research: "Research",
  operations: "Operations",
  mixed: "Multiple crafts",
  publicly_documenting: "Building in public",
  explicitly_private: "Building privately",
  solo: "Solo founder",
  cofounder: "Co-founder",
};
function FounderDna({ dna }: { dna: LocalFounderDna }) {
  return (
    <section className="panel founder-dna" aria-labelledby="founder-dna-title">
      <div className="founder-dna-heading">
        <h2 id="founder-dna-title">Founder DNA</h2>
        <span className="founder-dna-badge">From saved founder sources</span>
      </div>
      <p className="founder-dna-intro">
        A view of their work, based on the saved founder sources.
      </p>
      <dl className="founder-dna-facets">
        {dna.facets.map((facet) => (
          <div key={facet.key} data-known={facet.value !== "unknown"}>
            <dt>{facetLabels[facet.key]}</dt>
            <dd>{valueLabels[facet.value]}</dd>
          </div>
        ))}
      </dl>
      <p className="founder-dna-note">
        Categories are model inferences. “Not yet known” means the saved sources
        do not give enough evidence.
      </p>
      {dna.facts.length ? (
        <div className="founder-dna-facts">
          <h3>What the saved sources tell us</h3>
          <ul>
            {dna.facts.map((fact, index) => (
              <li key={index}>
                <p>{fact.text}</p>
                <span>
                  {fact.sourceIds.map((id) => {
                    const source = dna.sources.find(
                      (source) => source.id === id,
                    )!;
                    return (
                      <a
                        key={id}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Source ↗
                      </a>
                    );
                  })}
                </span>
              </li>
            ))}
          </ul>
          <p className="founder-dna-note">
            Supported by the saved sources; not independently verified.
          </p>
        </div>
      ) : null}
      <details className="founder-dna-evidence">
        <summary>View evidence and classification details</summary>
        <p className="founder-dna-note">
          Saved result · {dna.model} ·{" "}
          {new Date(dna.completedAt).toISOString().slice(0, 10)}
        </p>
        {dna.sources.map((source) => (
          <div key={source.id}>
            <blockquote>{source.text}</blockquote>
            <a href={source.url} target="_blank" rel="noreferrer">
              Open source ↗
            </a>
          </div>
        ))}
        <p className="founder-dna-note">
          All sources considered are shown above. Confidence is the model’s
          certainty about its classification, including an unknown result. It is
          not a skill or ability score.
        </p>
        <ul className="founder-dna-confidence">
          {dna.facets.map((facet) => (
            <li key={facet.key}>
              {facetLabels[facet.key]}: {Math.round(facet.confidence * 100)}%
              model confidence
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
