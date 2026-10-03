import Link from "next/link";
import type { ReactNode } from "react";
import {
  founderCoverage,
  type CoverageAxis,
  type FounderDnaProfile,
} from "@/lib/founder-dna";
import { founderShareImageUrl, founderShareText } from "@/lib/founder-share";
import { SiteHeader } from "./site-header";
import { FounderDnaShare } from "./founder-dna-share";
import { Claim } from "./products-view";
import { ProductImage } from "./product-image";
import { FounderAvatar } from "./founder-avatar";

const sourceLabels = {
  bio: "Saved bio",
  post: "Saved post",
  biography: "Official biography",
  product: "Product source",
};
const facetLabels = {
  venture_domain: "Working on",
  craft: "Craft",
  building_style: "Building style",
  founding_role: "Founding role",
};
function valueLabel(value: string) {
  return value === "unknown" ? "Not yet known" : value.replace(/_/g, " ");
}
function initials(name: string) {
  const letters = name
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("");
  return (letters || "?").slice(0, 2).toUpperCase();
}

/** Evidence coverage as a spider chart. Gold axes are missing from the sources. */
function CoverageRadar({ axes }: { axes: CoverageAxis[] }) {
  const size = 320,
    center = size / 2,
    radius = 108;
  const point = (index: number, scale: number) => {
    const angle = (Math.PI * 2 * index) / axes.length - Math.PI / 2;
    return [
      center + Math.cos(angle) * radius * scale,
      center + Math.sin(angle) * radius * scale,
    ];
  };
  const ring = (scale: number) =>
    axes.map((_, index) => point(index, scale).join(",")).join(" ");
  const shape = axes
    .map((axis, index) => point(index, Math.max(axis.value, 0.06)).join(","))
    .join(" ");
  const missing = axes.filter((axis) => axis.value === 0).map((a) => a.label);
  return (
    <figure className="dna-radar">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`Evidence coverage. Established: ${axes
          .filter((a) => a.value > 0)
          .map((a) => a.label)
          .join(", ")}. Missing: ${missing.join(", ") || "none"}.`}
      >
        {[0.33, 0.66, 1].map((scale) => (
          <polygon
            key={scale}
            points={ring(scale)}
            className="dna-radar-ring"
          />
        ))}
        {axes.map((_, index) => {
          const [x, y] = point(index, 1);
          return (
            <line
              key={index}
              x1={center}
              y1={center}
              x2={x}
              y2={y}
              className="dna-radar-spoke"
            />
          );
        })}
        <polygon points={shape} className="dna-radar-shape" />
        {axes.map((axis, index) => {
          const [x, y] = point(index, 1.24);
          return (
            <text
              key={axis.key}
              x={x}
              y={y}
              textAnchor={
                Math.abs(x - center) < 4
                  ? "middle"
                  : x > center
                    ? "start"
                    : "end"
              }
              dominantBaseline="middle"
              className={
                axis.value ? "dna-radar-label" : "dna-radar-label missing"
              }
            >
              {axis.label}
            </text>
          );
        })}
      </svg>
      <figcaption>
        What the sources establish. <span>Gold means missing.</span>
      </figcaption>
    </figure>
  );
}

export function FounderDnaProfileView({
  profile,
  connections,
}: {
  profile: FounderDnaProfile;
  connections?: ReactNode;
}) {
  const { portrait } = profile;
  // Lead with the best-documented product: image, then website, then description.
  const rank = (product: (typeof profile.products)[number]) =>
    (product.imageUrl ? 4 : 0) +
    (product.website ? 2 : 0) +
    (product.description.value?.length ?? 0) / 1000;
  const [lead, ...others] = [...profile.products].sort(
    (a, b) => rank(b) - rank(a),
  );
  return (
    <>
      <SiteHeader />
      <main className="dna-page released-dna-profile">
        <Link className="back" href="/directory">
          ← Find founders
        </Link>
        <article className="dna-card">
          <div className="dna-grid">
            <section className="dna-identity">
              <header className="dna-person">
                <FounderAvatar
                  src={profile.avatarUrl}
                  initials={initials(profile.name)}
                />
                <div>
                  <h1>{profile.name}</h1>
                  <p>
                    @{profile.handle}
                    {profile.location ? ` · ${profile.location}` : ""}
                  </p>
                </div>
              </header>
              <p className="dna-eyebrow">Founder DNA</p>
              <h2>{portrait.archetype.title}</h2>
              <p className="dna-hook">{portrait.archetype.hook}</p>
              <div className="dna-tags">
                {portrait.archetype.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <p className="dna-summary">{portrait.archetype.summary}</p>
            </section>
            <section className="dna-coverage" aria-label="Evidence coverage">
              <CoverageRadar axes={founderCoverage(profile)} />
            </section>
            <section className="dna-building">
              {lead ? (
                <>
                  {lead.imageUrl ? (
                    <ProductImage
                      name={lead.name.value ?? "Product"}
                      imageUrl={lead.imageUrl}
                      website={lead.website}
                    />
                  ) : null}
                  <p className="dna-eyebrow">What they are building</p>
                  <h3>
                    <Claim claim={lead.name} fallback="Product" />
                  </h3>
                  <p className="dna-product-description">
                    <Claim
                      claim={lead.description}
                      fallback="Description not yet known"
                    />
                  </p>
                  {lead.website ? (
                    <a href={lead.website} target="_blank" rel="noreferrer">
                      Visit site ↗
                    </a>
                  ) : null}
                  {others.length ? (
                    <div className="dna-also">
                      <p className="dna-eyebrow">Also building</p>
                      <ul>
                        {others.map((product, index) => (
                          <li key={index}>
                            {product.website ? (
                              <a
                                href={product.website}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <Claim
                                  claim={product.name}
                                  fallback="Product"
                                />
                              </a>
                            ) : (
                              <Claim claim={product.name} fallback="Product" />
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {profile.bio ? (
                    <p className="dna-bio">
                      <span className="dna-eyebrow">In their words</span>
                      {profile.bio}
                    </p>
                  ) : null}
                </>
              ) : (
                <>
                  <p className="dna-eyebrow">{portrait.story.title}</p>
                  <p className="dna-story">{portrait.story.connection}</p>
                  {profile.bio ? (
                    <p className="dna-bio">
                      <span className="dna-eyebrow">In their words</span>
                      {profile.bio}
                    </p>
                  ) : null}
                </>
              )}
              <p className="dna-links">
                <a
                  href={`https://x.com/${profile.handle}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  @{profile.handle} on X ↗
                </a>
                {profile.website ? (
                  <a href={profile.website} target="_blank" rel="noreferrer">
                    Website ↗
                  </a>
                ) : null}
              </p>
            </section>
          </div>
          <section className="dna-roast">
            <p className="dna-eyebrow">The friendly roast</p>
            <h2>{portrait.roast.title}</h2>
            <ul>
              {portrait.roast.lines.map((line, index) => (
                <li key={index}>{line.text}</li>
              ))}
            </ul>
            <a href="#founder-share-title">Share this roast ↓</a>
          </section>
        </article>
        {connections}
        <details className="profile-why">
          <summary>
            Why this fits <span>See the sources behind the portrait</span>
          </summary>
          <p className="founder-dna-note">
            The portrait and roast are playful interpretations of public
            sources. The factual claims were checked against the saved sources;
            they are not independent verification.
          </p>
          <dl className="founder-dna-facets">
            {profile.facets.map((facet) => (
              <div key={facet.key}>
                <dt>{facetLabels[facet.key]}</dt>
                <dd>{valueLabel(facet.value)}</dd>
              </div>
            ))}
          </dl>
          <p className="founder-dna-note">
            Categories are model inferences. “Not yet known” means the sources
            do not establish a category.
          </p>
          <ul>
            {profile.facts.map((fact) => (
              <li key={fact.id}>
                <p>{fact.text}</p>
                {fact.sourceIds.map((id) => {
                  const source = profile.sources.find((s) => s.id === id);
                  return source ? (
                    <a
                      key={id}
                      className="dna-fact-source"
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {source.label} ↗
                    </a>
                  ) : null;
                })}
              </li>
            ))}
          </ul>
          <div className="portrait-receipt-grid">
            {profile.sources.map((source) => (
              <article key={source.id}>
                <span>{sourceLabels[source.kind]}</span>
                <h3>{source.label}</h3>
                <blockquote>{source.excerpt}</blockquote>
                <a href={source.url} target="_blank" rel="noreferrer">
                  View source ↗
                </a>
              </article>
            ))}
          </div>
        </details>
        <FounderDnaShare
          profileId={profile.id}
          handle={profile.handle}
          profileRevision={profile.revision}
          releaseId={profile.releaseId}
          text={founderShareText(profile)}
          imageUrl={founderShareImageUrl(profile).replace(
            "https://foundersdirectory.app",
            "",
          )}
        />
      </main>
    </>
  );
}
