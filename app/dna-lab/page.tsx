import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadLocalPortraitFounders } from "@/lib/product-snapshot";
import { PRODUCT_CATEGORIES } from "@/lib/products";
import { SiteHeader } from "../site-header";
import { CopyPortrait } from "./copy-portrait";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Founder DNA — Portrait lab",
  robots: { index: false, follow: false },
};
const concepts = [
  {
    id: "archetype",
    number: "01",
    title: "The archetype",
    note: "Your founder energy",
  },
  {
    id: "roast",
    number: "02",
    title: "The friendly roast",
    note: "A little too accurate",
  },
  {
    id: "story",
    number: "03",
    title: "The plot twist",
    note: "The dots connect",
  },
] as const;
const categoryLabels: Record<string, string> = {
  ...Object.fromEntries(PRODUCT_CATEGORIES.map((c) => [c.id, c.label])),
  technical: "Technical",
  creative_branding: "Creative & branding",
  research: "Research",
  operations: "Operations",
  mixed: "Multiple crafts",
  publicly_documenting: "Building in public",
  explicitly_private: "Building privately",
  solo: "Solo founder",
  cofounder: "Co-founder",
  unknown: "Not yet known",
};
const facetLabels: Record<string, string> = {
  venture_domain: "Venture",
  craft: "Craft",
  building_style: "Building style",
  founding_role: "Role",
};
export default async function PortraitLab({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [founders, params] = await Promise.all([
    loadLocalPortraitFounders(),
    searchParams,
  ]);
  if (!founders.length) notFound();
  const founder =
    typeof params.founder === "string"
      ? founders.find(
          (f) => f.handle === params.founder?.toString().toLowerCase(),
        )
      : founders[0];
  if (!founder) notFound();
  const concept = concepts.find((c) => c.id === params.concept) ?? concepts[0];
  const portrait = founder.portrait;
  const shareText =
    concept.id === "archetype"
      ? portrait.shareText
      : concept.id === "roast"
        ? `${portrait.roast.title}\n\n${portrait.roast.lines[0].text}\n\n#FounderDNA`
        : `${portrait.story.title}\n\n${portrait.story.connection}\n\n#FounderDNA`;
  return (
    <>
      <SiteHeader />
      <main className="portrait-lab">
        <div className="portrait-lab-top">
          <p className="portrait-eyebrow">Founder DNA / Portrait lab</p>
          <span>Local editorial prototype</span>
        </div>
        <header className="portrait-lab-intro">
          <h1>
            Wait. That’s <em>me.</em>
          </h1>
          <p>
            Same founder. Three different mirrors.
            <br />
            Built from the things you actually shared.
          </p>
        </header>
        <nav className="portrait-people" aria-label="Choose a founder">
          {founders.map((person) => (
            <Link
              key={person.handle}
              href={`/dna-lab?founder=${person.handle}&concept=${concept.id}`}
              aria-current={
                person.handle === founder.handle ? "page" : undefined
              }
            >
              <span>{(person.name || person.handle).slice(0, 1)}</span>
              {person.name || person.handle}
            </Link>
          ))}
        </nav>
        <nav
          className="portrait-concepts"
          aria-label="Choose a portrait concept"
        >
          {concepts.map((item) => (
            <Link
              key={item.id}
              href={`/dna-lab?founder=${founder.handle}&concept=${item.id}`}
              aria-current={concept.id === item.id ? "page" : undefined}
            >
              <small>{item.number}</small>
              <strong>{item.title}</strong>
              <span>{item.note}</span>
            </Link>
          ))}
        </nav>
        <section
          className={`portrait-card portrait-${concept.id}`}
          aria-label={`${concept.title} for ${founder.name || founder.handle}`}
        >
          <div className="portrait-card-masthead">
            <span>
              FOUNDER
              <br />
              <b>DNA</b>
            </span>
            <span>
              {concept.number} / {concept.title}
            </span>
          </div>
          {concept.id === "archetype" ? (
            <>
              <div className="portrait-orbit" aria-hidden="true">
                <i />
                <i />
                <i />
                <span>✳</span>
              </div>
              <p className="portrait-kicker">{portrait.archetype.kicker}</p>
              <h2>{portrait.archetype.title}</h2>
              <p className="portrait-hook">{portrait.archetype.hook}</p>
              <div className="portrait-tags">
                {portrait.archetype.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <p className="portrait-summary">{portrait.archetype.summary}</p>
            </>
          ) : concept.id === "roast" ? (
            <>
              <div className="portrait-roast-stamp" aria-hidden="true">
                WITH
                <br />
                RECEIPTS ✳
              </div>
              <p className="portrait-kicker">
                Affectionate. Specific. Slightly personal.
              </p>
              <h2>{portrait.roast.title}</h2>
              <ol className="portrait-roast-lines">
                {portrait.roast.lines.map((line, index) => (
                  <li key={index}>
                    <span>0{index + 1}</span>
                    <p>{line.text}</p>
                    <a
                      href={`#receipt-${portrait.receipts.findIndex((r) => r.label === line.receipt)}`}
                    >
                      The receipt ↗
                    </a>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <>
              <p className="portrait-kicker">
                The connection hiding in plain sight.
              </p>
              <h2>{portrait.story.title}</h2>
              <div className="portrait-story-path">
                <div>
                  <span>CHAPTER 01 / THE BACKGROUND</span>
                  <h3>{portrait.story.before}</h3>
                </div>
                <b aria-hidden="true">↗</b>
                <div>
                  <span>CHAPTER 02 / THE BUILD</span>
                  <h3>{portrait.story.after}</h3>
                </div>
              </div>
              <div className="portrait-connection">
                <span>The connection</span>
                <p>{portrait.story.connection}</p>
              </div>
            </>
          )}
          <footer className="portrait-card-footer">
            <div>
              <strong>{founder.name || founder.handle}</strong>
              <span>@{founder.handle}</span>
            </div>
            <span>
              Based on saved bio + product data
              <br />
              An editorial take, not a personality test.
            </span>
          </footer>
        </section>
        <CopyPortrait
          key={`${founder.handle}-${concept.id}`}
          text={shareText}
        />
        <section className="portrait-receipts">
          <div className="portrait-section-heading">
            <div>
              <p className="portrait-eyebrow">Less horoscope. More evidence.</p>
              <h2>The receipts.</h2>
            </div>
            <Link href={`/u/${founder.handle}`}>View founder profile ↗</Link>
          </div>
          <div className="portrait-receipt-grid">
            {portrait.receipts.map((receipt, index) => (
              <article id={`receipt-${index}`} key={receipt.label}>
                <span>
                  {receipt.source === "bio"
                    ? "SAVED BIO"
                    : receipt.source === "post"
                      ? "SAVED POST"
                      : receipt.source === "biography"
                        ? "OFFICIAL BIO"
                        : "SAVED PRODUCT SUMMARY"}
                </span>
                <h3>{receipt.label}</h3>
                <blockquote>
                  {receipt.source !== "product"
                    ? `“${receipt.quote}”`
                    : receipt.quote}
                </blockquote>
                <a href={receipt.url} target="_blank" rel="noreferrer">
                  View source ↗
                </a>
              </article>
            ))}
          </div>
          <p className="portrait-evidence-note">
            The portraits above are written interpretations of these saved
            sources. The jokes are not additional facts.
          </p>
          {founder.dna ? (
            <details className="portrait-model-details">
              <summary>See the separate model classification</summary>
              <p>
                Saved {founder.dna.model} classifications. The model did not
                write these portraits.
              </p>
              <dl>
                {founder.dna.facets.map((facet) => (
                  <div key={facet.key}>
                    <dt>{facetLabels[facet.key]}</dt>
                    <dd>{categoryLabels[facet.value]}</dd>
                  </div>
                ))}
              </dl>
            </details>
          ) : null}
          <div className="portrait-products">
            <span>Building</span>
            {founder.products.map((product, index) => (
              <span key={index}>{product.name.value || "A product"}</span>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
