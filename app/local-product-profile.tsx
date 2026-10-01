import Link from "next/link";
import { Claim } from "./products-view";
import { ProductImage } from "./product-image";
import { SiteHeader } from "./site-header";
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
  const product = founder.products[0];
  return (
    <>
      <SiteHeader />
      <main className="profile profile-portrait local-card-page">
        <p className="profile-local-note" role="note">
          Local preview
        </p>
        <Link className="back" href="/products">
          ← Products
        </Link>
        <article className="founder-card" aria-label="Founder DNA card">
          <div className="founder-card-top">
            <section className="founder-card-identity" aria-label="Founder">
              <div className="founder-card-who">
                {founder.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={founder.avatarUrl}
                    alt=""
                    width={56}
                    height={56}
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="profile-initials" aria-hidden="true">
                    {(founder.name ?? founder.handle).slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div>
                  <h1>{founder.name ?? `@${founder.handle}`}</h1>
                  <p>
                    @{founder.handle}
                    {founder.location ? ` · ${founder.location}` : ""}
                  </p>
                </div>
              </div>
              <p className="profile-dna-eyebrow">Founder DNA</p>
              <h2>{founder.portrait?.archetype.title ?? "Portrait pending"}</h2>
              <p className="founder-card-hook">
                {founder.portrait?.archetype.hook ??
                  "No checked portrait from saved sources yet."}
              </p>
              {founder.portrait ? (
                <div className="portrait-tags">
                  {founder.portrait.archetype.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              ) : null}
              {founder.bio ? (
                <p className="founder-card-bio">{founder.bio}</p>
              ) : null}
            </section>
            <EvidenceMap
              bio={!!founder.bio}
              product={!!product?.name.value}
              audience={!!product?.audience.value}
              stage={!!product?.stage.value}
            />
            <section
              className="founder-card-product"
              aria-label="What they are building"
            >
              {product?.imageUrl ? (
                <ProductImage
                  name={product.name.value ?? "Product"}
                  imageUrl={product.imageUrl}
                  website={product.website}
                />
              ) : null}
              <div className="founder-card-product-body">
                <p className="profile-dna-eyebrow">What they are building</p>
                <h3>
                  <Claim claim={product.name} fallback="Unnamed product" />
                </h3>
                <p>
                  <Claim
                    claim={product.description}
                    fallback="Description not yet known"
                  />
                </p>
                <div className="founder-card-product-meta">
                  {product.audience.value ? (
                    <p>
                      For <Claim claim={product.audience} fallback="" />
                    </p>
                  ) : null}
                  {product.domain.value ? (
                    <span>
                      <Claim claim={product.domain} fallback="" />
                    </span>
                  ) : null}
                  {product.productType.value ? (
                    <span>
                      <Claim claim={product.productType} fallback="" />
                    </span>
                  ) : null}
                  {product.stage.value ? (
                    <p>
                      Stage · <Claim claim={product.stage} fallback="" />
                    </p>
                  ) : null}
                  <p>Price not stated</p>
                  {product.website ? (
                    <a href={product.website} target="_blank" rel="noreferrer">
                      Visit site ↗
                    </a>
                  ) : null}
                </div>
              </div>
            </section>
          </div>
          <section className="founder-card-roast">
            <p className="profile-dna-eyebrow">
              {founder.portrait
                ? "The friendly roast · Editorial interpretation"
                : "Portrait status · Local preview"}
            </p>
            {founder.portrait ? (
              <>
                <h3>{founder.portrait.roast.title}</h3>
                <ul>
                  {founder.portrait.roast.lines.map((line, index) => (
                    <li key={index}>{line.text}</li>
                  ))}
                </ul>
              </>
            ) : (
              <h3>Roast pending source review</h3>
            )}
            <p className="founder-card-gaps">
              Indexing post not saved <span>·</span> Founding role not
              established <span>·</span> Price not stated
            </p>
          </section>
        </article>
        {!founder.portrait && founder.dna ? (
          <FounderDna dna={founder.dna} />
        ) : null}
        {!founder.portrait && founder.products.length > 1 ? (
          <section className="panel profile-products">
            <h2>More saved products</h2>
            {founder.products.slice(1).map((item, index) => (
              <article className="local-founder-product" key={index}>
                <h3>
                  <Claim claim={item.name} fallback="Unnamed product" />
                </h3>
                <p>
                  <Claim
                    claim={item.description}
                    fallback="Description not yet known"
                  />
                </p>
                {item.website ? (
                  <a href={item.website} target="_blank" rel="noreferrer">
                    Visit site ↗
                  </a>
                ) : null}
              </article>
            ))}
          </section>
        ) : null}
        {founder.portrait ? (
          <>
            <section className="profile-share">
              <h2>Share this card</h2>
              <CopyPortrait text={founder.portrait.shareText} />
            </section>
            <details className="profile-why">
              <summary>
                Why this fits <span>See the sources behind the portrait</span>
              </summary>
              <p className="founder-dna-note">
                The portrait is an editorial reading of saved public sources.
                The jokes are interpretations, not new facts. Model
                classifications are shown separately below.
              </p>
              <div className="profile-kept-reading">
                <h3>{founder.portrait.story.title}</h3>
                <p>{founder.portrait.story.connection}</p>
                <p>{founder.portrait.archetype.summary}</p>
              </div>
              {founder.bio ? (
                <article className="profile-saved-bio">
                  <span>Saved bio</span>
                  <blockquote>“{founder.bio}”</blockquote>
                </article>
              ) : null}
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
              {founder.products.slice(1).map((item, index) => (
                <article className="local-founder-product" key={index}>
                  <h3>
                    <Claim claim={item.name} fallback="Unnamed product" />
                  </h3>
                  <p>
                    <Claim
                      claim={item.description}
                      fallback="Description not yet known"
                    />
                  </p>
                  {item.website ? (
                    <a href={item.website} target="_blank" rel="noreferrer">
                      Visit site ↗
                    </a>
                  ) : null}
                </article>
              ))}
            </details>
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

function EvidenceMap({
  bio,
  product,
  audience,
  stage,
}: {
  bio: boolean;
  product: boolean;
  audience: boolean;
  stage: boolean;
}) {
  const items = [
    { label: "Bio", known: bio },
    { label: "Product", known: product },
    { label: "Audience", known: audience },
    { label: "Stage", known: stage },
    { label: "Role", known: false },
    { label: "Indexing post", known: false },
  ];
  return (
    <section className="founder-card-map" aria-label="Saved source coverage">
      <p className="profile-dna-eyebrow">Source coverage</p>
      <svg viewBox="0 0 340 310" aria-hidden="true" focusable="false">
        <polygon
          points="170,45 272,103 272,207 170,265 68,207 68,103"
          fill="none"
          stroke="#3c4236"
        />
        <path
          d="M170 155V45 M170 155L272 103 M170 155L272 207 M170 155V265 M170 155L68 207 M170 155L68 103"
          stroke="#3c4236"
        />
        {items.map((item, index) => {
          const points = [
            [170, 45],
            [272, 103],
            [272, 207],
            [170, 265],
            [68, 207],
            [68, 103],
          ];
          const [x, y] = points[index];
          return (
            <circle
              key={item.label}
              cx={x}
              cy={y}
              r="8"
              fill={item.known ? "#d8fa70" : "#e6c27a"}
            />
          );
        })}
      </svg>
      <ul>
        {items.map((item) => (
          <li key={item.label} data-known={item.known}>
            <span>{item.label}</span>
            <strong>{item.known ? "Saved" : "Gap"}</strong>
          </li>
        ))}
      </ul>
      <p className="founder-card-map-note">
        What saved fields establish, not a skill score. Gold marks gaps.
      </p>
    </section>
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
