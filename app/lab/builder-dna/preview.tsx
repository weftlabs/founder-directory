"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { BuilderDnaExample } from "@/lib/builder-dna";
import { SiteHeader } from "../../site-header";
import styles from "./preview.module.css";

function sourceCount(example: BuilderDnaExample) {
  return new Set(example.evidence.map((item) => item.url)).size;
}

export default function BuilderDnaPreview({
  examples,
}: {
  examples: BuilderDnaExample[];
}) {
  const [query, setQuery] = useState("");
  const [craft, setCraft] = useState<string | null>(null);
  const crafts = useMemo(
    () => [...new Set(examples.flatMap((example) => example.craft))].sort(),
    [examples],
  );
  const filtered = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return examples.filter((example) => {
      const text = [
        example.name,
        example.handle,
        example.location,
        example.product,
        example.signature,
        example.summary,
        ...example.craft,
        ...example.productTags,
        ...example.domains,
        ...example.workingStyle,
      ]
        .join(" ")
        .toLocaleLowerCase();
      return (
        (!craft || example.craft.includes(craft)) &&
        terms.every((term) => text.includes(term))
      );
    });
  }, [examples, query, craft]);
  function reset() {
    setQuery("");
    setCraft(null);
  }
  return (
    <>
      <SiteHeader />
      <main className="dir" id="directory">
        <h1 className="hero">Find the people building.</h1>
        <p className="lede">
          Explore founders by craft, product and domain. Select a card to see
          their Builder DNA and the evidence behind it.
        </p>
        <p className={styles.notice}>
          Local preview · saved public-source snapshots, not live background
          enrichment.
        </p>
        <div className="search">
          <input
            data-testid="dna-search"
            type="search"
            aria-label="Search builders by name, product, domain or working style"
            placeholder="Search name, product, domain…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="count">{filtered.length} founders</span>
        </div>
        <div className={styles.filters}>
          <span className="filter-label">Craft</span>
          <div className="chips">
            <button
              type="button"
              data-testid="dna-craft-filter"
              aria-pressed={craft === null}
              onClick={() => setCraft(null)}
            >
              All crafts
            </button>
            {crafts.map((value) => (
              <button
                key={value}
                type="button"
                data-testid="dna-craft-filter"
                aria-pressed={craft === value}
                onClick={() => setCraft(craft === value ? null : value)}
              >
                {value}
              </button>
            ))}
          </div>
          <button
            className="clear-filters"
            type="button"
            onClick={reset}
            disabled={!query && !craft}
          >
            Reset filters
          </button>
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {filtered.length} founders found
        </p>
        <div className="grid">
          {filtered.map((example) => (
            <Link
              className={`card ${styles.founderCard}`}
              data-testid="dna-founder-card"
              key={example.handle}
              href={`/u/${example.handle}`}
            >
              <span className="card-top">
                <span className={styles.avatar} aria-hidden="true">
                  {example.initials}
                </span>
                <span>
                  <span className="cat">{example.craft.join(" · ")}</span>
                  <strong className={styles.cardName}>{example.name}</strong>
                  <span className="handle">
                    @{example.handle} · {example.location}
                  </span>
                </span>
              </span>
              <span className={styles.cardSignature}>{example.signature}</span>
              <span className={styles.cardSummary}>{example.summary}</span>
              <span className={styles.cardMeta}>
                {example.product} · {example.domains.join(" · ")}
              </span>
              <span className={styles.cardMeta}>
                {sourceCount(example)} source links · Inferred
              </span>
            </Link>
          ))}
        </div>
        {!filtered.length && (
          <div className="empty" data-testid="dna-empty">
            <p>
              {examples.length
                ? "No one matches that filter."
                : "No public-source examples have been saved for this preview yet."}
            </p>
            <button className="clear-filters" type="button" onClick={reset}>
              Reset filters
            </button>
          </div>
        )}
      </main>
    </>
  );
}
