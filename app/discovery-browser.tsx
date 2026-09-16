"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useMemo, useState } from "react";
import {
  filterDiscovery,
  rankFounders,
  type DiscoveryFounder,
  type Metric,
  type DiscoveryPageInfo,
  type DiscoveryQuery,
} from "@/lib/discovery";
import { safeHttpUrl } from "@/lib/model";

const FounderMap = dynamic(() => import("./founder-map"), {
  ssr: false,
  loading: () => <div className="atlas-loading">Opening the world…</div>,
});
const number = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function FounderAvatar({ founder }: { founder: DiscoveryFounder }) {
  const url = safeHttpUrl(founder.avatarUrl);
  return url ? (
    <Image
      unoptimized
      className="discovery-avatar"
      src={url}
      alt=""
      width={44}
      height={44}
      loading="lazy"
    />
  ) : (
    <span className="discovery-avatar initials" aria-hidden="true">
      {founder.name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")}
    </span>
  );
}

export function DiscoveryBrowser({
  founders,
  mode,
  unavailable = false,
  serverPage,
  navigationBase,
}: {
  founders: DiscoveryFounder[];
  mode: "map" | "leaderboard";
  unavailable?: boolean;
  serverPage?: DiscoveryPageInfo;
  navigationBase?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(serverPage?.query.q ?? "");
  const [category, setCategory] = useState(serverPage?.query.category ?? "");
  const [country, setCountry] = useState(serverPage?.query.country ?? "");
  const [metric, setMetric] = useState<Metric>(
    serverPage?.query.metric ?? "likes",
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [limit, setLimit] = useState(48);
  const [group, setGroup] = useState<string[]>([]);
  const filtered = useMemo(
    () =>
      serverPage ? founders : filterDiscovery(founders, q, category, country),
    [founders, q, category, country, serverPage],
  );
  const mapped = useMemo(
    () => filtered.filter((f) => f.coordinates),
    [filtered],
  );
  const ranked = useMemo(
    () => rankFounders(filtered, metric),
    [filtered, metric],
  );
  const rows = mode === "map" ? filtered : ranked;
  const groupFounders = filtered.filter((f) => group.includes(f.handle));
  const active = filtered.find((f) => f.handle === selected) ?? null;
  const countries =
    serverPage?.countries ??
    [
      ...new Set(
        founders.map((f) => f.country).filter((c): c is string => Boolean(c)),
      ),
    ].sort();
  const categories =
    serverPage?.categories ??
    [...new Set(founders.map((f) => f.category))].sort();
  const selectedMetric = mode === "leaderboard" ? metric : "likes";
  const top =
    mode === "leaderboard" && (!serverPage || serverPage.query.page === 1)
      ? ranked.slice(0, 3)
      : [];
  const total = serverPage?.total ?? filtered.length;
  const mappedTotal = serverPage?.mappedTotal ?? mapped.length;
  const offset = serverPage ? (serverPage.query.page - 1) * 48 : 0;
  function pageUrl(changes: Partial<DiscoveryQuery> = {}) {
    const values = {
      ...serverPage?.query,
      q,
      category,
      country,
      metric,
      page: 1,
      ...changes,
    };
    const [pathname, search] = (navigationBase ?? `/${mode}`).split("?");
    const params = new URLSearchParams(search);
    for (const [key, value] of Object.entries(values))
      if (value) params.set(key, String(value));
    return `${pathname}?${params}`;
  }
  function navigate(changes: Partial<DiscoveryQuery>) {
    if (serverPage) router.push(pageUrl(changes));
  }

  function clear() {
    if (serverPage) {
      router.push(navigationBase ?? `/${mode}`);
      return;
    }
    setQ("");
    setCategory("");
    setCountry("");
    setSelected(null);
    setGroup([]);
    setLimit(48);
  }
  return (
    <main className={`discovery ${mode === "map" ? "atlas" : "leaderboard"}`}>
      <div className="discovery-intro">
        <div>
          <p className="eyebrow">
            <span className="live-dot" /> THE PEOPLE BEHIND THE PRODUCTS
          </p>
          <h1>
            {mode === "map" ? (
              <>
                Big ideas.
                <br />
                <em>Everywhere.</em>
              </>
            ) : (
              <>
                Small teams.
                <br />
                <em>Big attention.</em>
              </>
            )}
          </h1>
          <p className="discovery-lede">
            {mode === "map"
              ? "Find your corner of the founder world. Explore a city, discover a builder, start a conversation."
              : "The introductions people noticed. Explore founders by likes or views on their public X intro."}
          </p>
        </div>
        <div className="discovery-stats">
          <div>
            <b>{number.format(serverPage?.globalTotal ?? founders.length)}</b>
            <span>founders</span>
          </div>
          <div>
            <b>{countries.length}</b>
            <span>countries listed</span>
          </div>
          <Link href={mode === "map" ? "/leaderboard" : "/map"}>
            {mode === "map"
              ? "Explore the leaderboard ↗"
              : "Meet them on the map ↗"}
          </Link>
        </div>
      </div>
      {unavailable ? (
        <p className="discovery-notice" role="alert">
          The directory could not be loaded. Please try again later.
        </p>
      ) : null}
      <form
        className="discovery-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          navigate({ q });
        }}
      >
        <label className="discovery-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            aria-label="Search founders, cities or countries"
            placeholder="Search people, places, ideas…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setLimit(48);
            }}
          />
        </label>
        {serverPage ? (
          <button className="discovery-search-submit" type="submit">
            Search
          </button>
        ) : null}
        <label className="discovery-select">
          <span className="sr-only">Country</span>
          <select
            aria-label="Country"
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              navigate({ country: e.target.value, city: "" });
              setLimit(48);
            }}
          >
            <option value="">Everywhere</option>
            {countries.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        {q || category || country ? (
          <button className="discovery-clear" type="button" onClick={clear}>
            Clear filters
          </button>
        ) : null}
      </form>
      {serverPage?.query.city ? (
        <p className="coverage-note">
          City: {serverPage.query.city}{" "}
          <a href={pageUrl({ city: "" })}>Clear city</a>
        </p>
      ) : null}
      <div className="discovery-tabs">
        <div className="craft-tabs" aria-label="Founder categories">
          <button
            aria-pressed={!category}
            onClick={() => {
              setCategory("");
              navigate({ category: "" });
              setLimit(48);
            }}
          >
            All builders
          </button>
          {categories.map((c) => (
            <button
              key={c}
              aria-pressed={category === c}
              onClick={() => {
                setCategory(c);
                navigate({ category: c });
                setLimit(48);
              }}
            >
              {c === "Unclear" ? "Uncategorized" : c}
            </button>
          ))}
        </div>
        {mode === "leaderboard" ? (
          <div className="metric-tabs" aria-label="Rank by">
            <button
              aria-pressed={metric === "likes"}
              onClick={() => {
                setMetric("likes");
                navigate({ metric: "likes" });
                setLimit(48);
              }}
            >
              ♡ Most liked
            </button>
            <button
              aria-pressed={metric === "views"}
              onClick={() => {
                setMetric("views");
                navigate({ metric: "views" });
                setLimit(48);
              }}
            >
              ◉ Most viewed
            </button>
          </div>
        ) : null}
      </div>
      {mode === "leaderboard" ? (
        <>
          <p className="ranking-explanation">
            Ranked by recorded X intro {metric}. These are snapshots, not live
            counts. {total - (serverPage?.rankedTotal ?? ranked.length)}{" "}
            founders have no recorded {metric}.
          </p>
          {top.length ? (
            <div className="podium">
              {top.map((f, i) => (
                <Link
                  prefetch={false}
                  className="podium-card"
                  key={f.handle}
                  href={`/u/${f.handle}`}
                >
                  <span className="podium-rank">
                    0{i + 1}
                    <span>{i === 0 ? "THE SPOTLIGHT" : "ON THE RADAR"}</span>
                  </span>
                  <FounderAvatar founder={f} />
                  <h2>{f.name}</h2>
                  <p>
                    @{f.handle} ·{" "}
                    {[f.city, f.country].filter(Boolean).join(", ") ||
                      "Location not listed"}
                  </p>
                  <strong>
                    {number.format(f.introMetrics![metric]!)}{" "}
                    <small>{metric}</small>
                  </strong>
                </Link>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
      <div className="discovery-body">
        <section
          className="founder-list"
          aria-label={
            mode === "map" ? "Founders on the map" : "Ranked founders"
          }
        >
          <div className="list-heading">
            <h2>{mode === "map" ? "Find your people" : "The leaderboard"}</h2>
            <span aria-live="polite">
              {serverPage
                ? `${rows.length} of ${mode === "map" ? total : serverPage.rankedTotal}`
                : rows.length}{" "}
              founders
            </span>
          </div>
          {mode === "map" ? (
            <p className="coverage-note">
              {mappedTotal} mapped · {total - mappedTotal} without a supported
              city. Pins show approximate city centers.
            </p>
          ) : null}
          {rows.length === 0 ? (
            <div className="discovery-empty">
              <span aria-hidden="true">◎</span>
              <h2>
                {(serverPage?.globalTotal ?? founders.length) &&
                (q || category || country || serverPage?.query.city)
                  ? "No founders match these filters."
                  : mode === "leaderboard"
                    ? "The spotlight is waiting."
                    : "The world is open."}
              </h2>
              <p>
                {mode === "leaderboard"
                  ? "Rankings appear when introduction metrics are recorded. Missing counts are never treated as zero."
                  : "Founders with supported public locations will appear here."}
              </p>
              {q || category || country ? (
                <button onClick={clear}>Clear filters</button>
              ) : (
                <Link href="/">Explore the directory ↗</Link>
              )}
            </div>
          ) : null}
          <ol className="discovery-rows">
            {rows.slice(0, limit).map((f, i) => (
              <li key={f.handle} data-selected={active?.handle === f.handle}>
                <span className="row-rank">
                  {mode === "leaderboard" ? (
                    String(offset + i + 1).padStart(2, "0")
                  ) : (
                    <span
                      className={
                        f.coordinates ? "located-dot" : "unlocated-dot"
                      }
                    />
                  )}
                </span>
                <FounderAvatar founder={f} />
                <div className="row-person">
                  <Link prefetch={false} href={`/u/${f.handle}`}>
                    <strong>{f.name}</strong> <span>@{f.handle}</span>
                  </Link>
                  <p>{f.bio || "A founder with an introduction to share."}</p>
                  <div className="row-details">
                    {mode === "map" && f.coordinates ? (
                      <button
                        aria-pressed={active?.handle === f.handle}
                        onClick={() => {
                          setSelected(f.handle);
                          setGroup([]);
                        }}
                        aria-label={`Show ${f.name} on map`}
                      >
                        ↗ {f.city}, {f.country}
                      </button>
                    ) : (
                      <span>
                        {[f.city, f.country].filter(Boolean).join(", ") ||
                          "Location not listed"}
                      </span>
                    )}
                    <span className="row-category">
                      {f.category === "Unclear" ? "Uncategorized" : f.category}
                    </span>
                  </div>
                </div>
                <div className="row-metrics">
                  <b>
                    {f.introMetrics?.[selectedMetric] != null
                      ? number.format(f.introMetrics[selectedMetric]!)
                      : "—"}
                  </b>
                  <span>intro {selectedMetric}</span>
                  {mode === "leaderboard" && f.introMetrics ? (
                    <small>
                      As of{" "}
                      {new Date(f.introMetrics.observedAt).toLocaleDateString(
                        "en",
                        { month: "short", day: "numeric", timeZone: "UTC" },
                      )}
                    </small>
                  ) : null}
                  {mode === "leaderboard" && safeHttpUrl(f.introUrl) ? (
                    <a
                      href={safeHttpUrl(f.introUrl)!}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Source ↗
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          {serverPage ? (
            <nav className="page-navigation" aria-label="Founder pages">
              {serverPage.query.page > 1 ? (
                <a href={pageUrl({ page: serverPage.query.page - 1 })}>
                  ← Previous
                </a>
              ) : null}
              {serverPage.hasMore ? (
                <a href={pageUrl({ page: serverPage.query.page + 1 })}>
                  Next page →
                </a>
              ) : null}
            </nav>
          ) : null}
          {!serverPage && rows.length > limit ? (
            <button
              className="discovery-more"
              onClick={() => setLimit((n) => n + 48)}
            >
              Show more founders
            </button>
          ) : null}
        </section>
        {mode === "map" ? (
          <section className="map-panel" aria-label="Interactive founder map">
            <FounderMap
              founders={mapped}
              places={serverPage?.places}
              onSelectPlace={(city, country) => navigate({ city, country })}
              selected={active}
              onSelect={(handle) => {
                setSelected(handle);
                setGroup([]);
              }}
              onSelectGroup={(handles) => {
                setGroup(handles);
                setSelected(null);
              }}
            />
            <div className="map-label">
              <span className="live-dot" /> A WORLD OF BUILDERS
            </div>
            {groupFounders.length ? (
              <div className="map-profile map-group">
                <button
                  className="map-profile-close"
                  aria-label="Close city founders"
                  onClick={() => setGroup([])}
                >
                  ×
                </button>
                <p className="eyebrow">EXPLORE THIS AREA</p>
                <h2>{groupFounders.length} founders</h2>
                <div>
                  {groupFounders.map((f) => (
                    <button
                      key={f.handle}
                      onClick={() => {
                        setSelected(f.handle);
                        setGroup([]);
                      }}
                    >
                      <FounderAvatar founder={f} />
                      <span>
                        {f.name}
                        <small>
                          {f.city}, {f.country}
                        </small>
                      </span>
                      <span>↗</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {active ? (
              <div className="map-profile">
                <button
                  className="map-profile-close"
                  aria-label="Close founder card"
                  onClick={() => setSelected(null)}
                >
                  ×
                </button>
                <FounderAvatar founder={active} />
                <p className="eyebrow">
                  {active.city}, {active.country}
                </p>
                <h2>{active.name}</h2>
                <p>{active.bio || `Meet @${active.handle}.`}</p>
                <Link prefetch={false} href={`/u/${active.handle}`}>
                  Meet this founder ↗
                </Link>
              </div>
            ) : null}
            <p className="map-credit">
              City centers: <a href="https://www.geonames.org/">GeoNames</a> ·{" "}
              <a href="https://creativecommons.org/licenses/by/4.0/">
                CC BY 4.0
              </a>
            </p>
          </section>
        ) : null}
      </div>
    </main>
  );
}
