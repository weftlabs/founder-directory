import type { BuilderDnaExample } from "@/lib/builder-dna";
import styles from "./lab/builder-dna/preview.module.css";

function sourceCount(example: BuilderDnaExample) {
  return new Set(example.evidence.map((item) => item.url)).size;
}
function Tags({ values }: { values: string[] }) {
  return values.length ? (
    <ul className="signals">
      {values.map((value) => (
        <li key={value}>{value}</li>
      ))}
    </ul>
  ) : (
    <span className="miss">Not established in saved sources</span>
  );
}
export function BuilderDnaProfile({ example }: { example: BuilderDnaExample }) {
  return (
    <article
      id="builder-profile"
      className={styles.detail}
      data-testid="dna-detail"
      aria-labelledby="selected-profile-name"
    >
      <div className="hero-row">
        <span className={styles.profileAvatar} aria-hidden="true">
          {example.initials}
        </span>
        <div>
          <p className="cat">{example.domains.join(" · ")}</p>
          <h1 id="selected-profile-name" className={styles.profileName}>
            {example.name}
          </h1>
          <p className="handle">
            @{example.handle} · {example.location}
          </p>
        </div>
      </div>
      <p className="bio">{example.summary}</p>
      <section className="panel">
        <h2>Builder DNA · inferred from sources</h2>
        <h3 className={styles.signature}>{example.signature}</h3>
        <p className={styles.context}>
          Building{" "}
          <a href={example.website} target="_blank" rel="noopener noreferrer">
            {example.product} ↗
          </a>
        </p>
        <dl className={styles.dimensions}>
          <div>
            <dt>Craft</dt>
            <dd>
              <Tags values={example.craft} />
            </dd>
          </div>
          <div>
            <dt>Product</dt>
            <dd>
              <Tags values={example.productTags} />
            </dd>
          </div>
          <div>
            <dt>Domain</dt>
            <dd>
              <Tags values={example.domains} />
            </dd>
          </div>
          <div>
            <dt>Working style</dt>
            <dd>
              <Tags values={example.workingStyle} />
            </dd>
          </div>
        </dl>
      </section>
      <section className="panel">
        <h2>Why this classification?</h2>
        <p className={styles.context}>{example.classificationReason}</p>
        <p className={styles.note}>
          Previously: {example.oldCategory}. These labels describe the available
          evidence, not a founder ranking or verified skill assessment.
        </p>
      </section>
      <section className="panel">
        <h2>Supporting evidence · {sourceCount(example)} source links</h2>
        <p className={styles.note}>
          Saved public-source snapshots. Links may share an underlying source.
          Product-site statements are publisher claims, not independent
          verification.
        </p>
        {example.evidence.map((item) => (
          <details className={styles.evidence} key={item.id}>
            <summary data-testid="dna-evidence-toggle">
              <span>
                {item.title}
                <small>
                  {item.kind === "self-reported"
                    ? "Self-reported"
                    : "Product-site claim"}{" "}
                  · {item.sourceLabel}
                </small>
              </span>
              <span className={styles.expand} aria-hidden="true">
                +
              </span>
            </summary>
            <blockquote className="tweet">{item.excerpt}</blockquote>
            <p className={styles.note}>
              Observed{" "}
              <time dateTime={item.observedAt}>
                {new Intl.DateTimeFormat("en", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                  timeZone: "UTC",
                }).format(new Date(item.observedAt))}
              </time>
            </p>
            <a
              className={styles.sourceLink}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open original source ↗
            </a>
          </details>
        ))}
      </section>
      <section className="panel">
        <h2>What we don’t know</h2>
        <ul className={styles.unknowns}>
          {example.unknowns.map((unknown) => (
            <li key={unknown}>{unknown}</li>
          ))}
        </ul>
      </section>
      <a className="back" href="/lab/builder-dna">
        ← Directory
      </a>
    </article>
  );
}
