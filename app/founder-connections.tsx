"use client";

import { useEffect, useRef, useState } from "react";
import {
  MAX_FOUNDER_CONNECTIONS,
  type FounderConnection,
} from "../lib/founder-dna";
import { capture } from "./analytics";
import styles from "./founder-connections.module.css";

export function FounderConnections({
  connections,
  founderId = "",
  revision = "",
}: {
  connections: FounderConnection[];
  founderId?: string;
  revision?: string;
}) {
  const items = connections.slice(0, MAX_FOUNDER_CONNECTIONS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find((item) => item.id === selectedId);
  const section = useRef<HTMLElement>(null);
  const recorded = useRef("");
  const signature = `${founderId}:${revision}:${items.map((item) => item.id).join(",")}`;
  useEffect(() => {
    if (
      !items.length ||
      !section.current ||
      recorded.current === signature ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        recorded.current = signature;
        capture("founder_connections_viewed", {
          founder_id: founderId,
          revision,
          connection_count: String(items.length),
        });
        observer.disconnect();
      },
      { threshold: 0.2 },
    );
    observer.observe(section.current);
    return () => observer.disconnect();
  }, [signature, founderId, revision, items.length]);
  const click = (item: FounderConnection, surface: string) =>
    capture("founder_connection_clicked", {
      founder_id: founderId,
      revision,
      connection_id: item.id,
      destination_id: item.founder.id,
      surface,
    });
  return (
    <section
      id="connections"
      ref={section}
      className={styles.section}
      aria-labelledby="connections-title"
    >
      <div className={styles.heading}>
        <p>FOLLOW THE WORK</p>
        <h2 id="connections-title">Explore connections</h2>
      </div>
      <p className={styles.intro}>
        People working on related problems. Each link comes with a reason and
        sources.
      </p>
      {!items.length ? (
        <p className={styles.empty}>
          No supported connections yet. More evidence can reveal the next link.
        </p>
      ) : (
        <>
          <div className={styles.graph} aria-label="Connection map">
            <div className={styles.center}>This founder</div>
            <div className={styles.branches}>
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={styles.node}
                  aria-pressed={selectedId === item.id}
                  aria-controls="connection-preview"
                  onClick={() => {
                    setSelectedId(item.id);
                    capture("founder_connection_previewed", {
                      founder_id: founderId,
                      revision,
                      connection_id: item.id,
                    });
                  }}
                >
                  <span className={styles.initial} aria-hidden="true">
                    {item.founder.name.slice(0, 1)}
                  </span>
                  <span>
                    {item.founder.name}
                    <small>@{item.founder.handle}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div
            id="connection-preview"
            className={styles.preview}
            aria-live="polite"
          >
            {selected ? (
              <>
                <p>{selected.reason}</p>
                <a
                  href={`/u/${selected.founder.handle}`}
                  onClick={() => click(selected, "graph")}
                >
                  Explore from @{selected.founder.handle} →
                </a>
              </>
            ) : (
              <p>Select a person to preview the connection.</p>
            )}
          </div>
          <ul className={styles.cards}>
            {items.map((item) => (
              <li key={item.id} className={styles.card}>
                <p className={styles.label}>RELATED WORK</p>
                <a
                  className={styles.name}
                  href={`/u/${item.founder.handle}`}
                  onClick={() => click(item, "card")}
                >
                  {item.founder.name} <span>→</span>
                </a>
                <p className={styles.handle}>@{item.founder.handle}</p>
                <p>{item.reason}</p>
                <details>
                  <summary>Why this connection</summary>
                  <ul>
                    {item.sources
                      .filter((source) => item.sourceIds.includes(source.id))
                      .map((source) => (
                        <li key={source.id}>
                          <a href={source.url} target="_blank" rel="noreferrer">
                            {source.label} ↗
                          </a>
                          <p>{source.excerpt}</p>
                        </li>
                      ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
