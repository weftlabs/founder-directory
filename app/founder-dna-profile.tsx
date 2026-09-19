import Link from "next/link";
import type { ReactNode } from "react";
import type { FounderDnaProfile } from "@/lib/founder-dna";
import { founderShareImageUrl, founderShareText } from "@/lib/founder-share";
import { SiteHeader } from "./site-header";
import { FounderDnaShare } from "./founder-dna-share";
import { Claim } from "./products-view";
import { ProductImage } from "./product-image";

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
export function FounderDnaProfileView({
  profile,
  connections,
}: {
  profile: FounderDnaProfile;
  connections?: ReactNode;
}) {
  const { portrait } = profile;
  return (
    <>
      <SiteHeader />
      <main className="profile profile-portrait released-dna-profile">
        <Link className="back" href="/directory">
          ← Find founders
        </Link>
        <div
          className={
            profile.avatarUrl ? "hero-row" : "hero-row hero-row-no-avatar"
          }
        >
          {profile.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatarUrl}
              alt=""
              width={96}
              height={96}
              referrerPolicy="no-referrer"
            />
          ) : null}
          <div>
            <h1>{profile.name}</h1>
            <p className="handle">
              @{profile.handle}
              {profile.location ? ` · ${profile.location}` : ""}
            </p>
          </div>
        </div>
        {profile.bio ? <p className="bio">{profile.bio}</p> : null}
        <section className="profile-dna-hero">
          <p className="profile-dna-eyebrow">Founder DNA</p>
          <h2>{portrait.archetype.title}</h2>
          <p className="profile-dna-hook">{portrait.archetype.hook}</p>
          <div className="portrait-tags">
            {portrait.archetype.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
          <p className="profile-dna-summary">{portrait.archetype.summary}</p>
        </section>
        <section className="profile-dna-roast">
          <p className="profile-dna-eyebrow">The friendly roast</p>
          <h2>{portrait.roast.title}</h2>
          <ul>
            {portrait.roast.lines.map((line, index) => (
              <li key={index}>{line.text}</li>
            ))}
          </ul>
          <a href="#founder-share-title">Share this roast ↓</a>
        </section>
        {connections ?? (
          <section className="panel">
            <h2>Explore connections</h2>
            <p>There are no checked connections to show yet.</p>
            <Link href="/directory">Find more founders →</Link>
          </section>
        )}
        <section className="profile-dna-connection">
          <p className="profile-dna-eyebrow">The connection in your story</p>
          <h2>{portrait.story.title}</h2>
          <p>{portrait.story.connection}</p>
        </section>
        {profile.products.length ? (
          <section className="panel">
            <h2>What they are building</h2>
            {profile.products.map((product, index) => (
              <article className="local-founder-product" key={index}>
                <ProductImage
                  name={product.name.value ?? "Product"}
                  imageUrl={product.imageUrl}
                  website={product.website}
                />
                <h3>
                  <Claim claim={product.name} fallback="Product" />
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
        ) : null}
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
          handle={profile.handle}
          revision={profile.revision}
          text={founderShareText(profile)}
          imageUrl={founderShareImageUrl(profile).replace(
            "https://foundersdirectory.app",
            "",
          )}
        />
        <section className="panel">
          <h2>Public links</h2>
          <a
            href={`https://x.com/${profile.handle}`}
            target="_blank"
            rel="noreferrer"
          >
            View @{profile.handle} on X ↗
          </a>
          {profile.website ? (
            <p>
              <a href={profile.website} target="_blank" rel="noreferrer">
                Website ↗
              </a>
            </p>
          ) : null}
        </section>
      </main>
    </>
  );
}
