"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useMemo, useState } from "react";
import {
  filterDiscovery,
  type DiscoveryFounder,
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
  unavailable = false,
  serverPage,
  navigationBase,
}: {
  founders: DiscoveryFounder[];
  unavailable?: boolean;
  serverPage?: DiscoveryPageInfo;
  navigationBase?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(serverPage?.query.q ?? "");
  const [category, setCategory] = useState(serverPage?.query.category ?? "");
  const [country, setCountry] = useState(serverPage?.query.country ?? "");
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
  const rows = filtered;
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
  const total = serverPage?.total ?? filtered.length;
  const mappedTotal = serverPage?.mappedTotal ?? mapped.length;
  function pageUrl(changes: Partial<DiscoveryQuery> = {}) {
    const values = {
      ...serverPage?.query,
      q,
      category,
      country,
      page: 1,
      ...changes,
    };
    const [pathname, search] = (navigationBase ?? "/").split("?");
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
      router.push(navigationBase ?? "/");
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
    <main className="discovery atlas">
      <div className="discovery-intro">
        <div>
          <p className="eyebrow">
            <span className="live-dot" /> THE PEOPLE BEHIND THE PRODUCTS
          </p>
          <h1>
            {
              <>
                Big ideas.
                <br />
                <em>Everywhere.</em>
              </>
            }
          </h1>
          <p className="discovery-lede">
            {
              "Find your corner of the founder world. Explore a city, discover a builder, start a conversation."
            }
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
          <Link href="/directory">Browse the directory ↗</Link>
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
          navigate({ q, bounds: "" });
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
              navigate({ country: e.target.value, city: "", bounds: "" });
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
              navigate({ category: "", bounds: "" });
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
                navigate({ category: c, bounds: "" });
                setLimit(48);
              }}
            >
              {c === "Unclear" ? "Uncategorized" : c}
            </button>
          ))}
        </div>
      </div>
      <div className="discovery-body">
        <section className="founder-list" aria-label="Founders on the map">
          <div className="list-heading">
            <h2>Find your people</h2>
            <span aria-live="polite">
              {serverPage ? `${rows.length} of ${total}` : rows.length} founders
            </span>
          </div>
          {
            <p className="coverage-note">
              {mappedTotal} mapped · {total - mappedTotal} without a supported
              city. Pins show approximate city centers.
            </p>
          }
          {rows.length === 0 ? (
            <div className="discovery-empty">
              <span aria-hidden="true">◎</span>
              <h2>
                {(serverPage?.globalTotal ?? founders.length) &&
                (q || category || country || serverPage?.query.city)
                  ? "No founders match these filters."
                  : "The world is open."}
              </h2>
              <p>
                {"Founders with supported public locations will appear here."}
              </p>
              {q || category || country ? (
                <button onClick={clear}>Clear filters</button>
              ) : (
                <Link href="/directory">Explore the directory ↗</Link>
              )}
            </div>
          ) : null}
          <ol className="discovery-rows">
            {rows.slice(0, limit).map((f) => (
              <li key={f.handle} data-selected={active?.handle === f.handle}>
                <span className="row-location">
                  {
                    <span
                      className={
                        f.coordinates ? "located-dot" : "unlocated-dot"
                      }
                    />
                  }
                </span>
                <FounderAvatar founder={f} />
                <div className="row-person">
                  <Link prefetch={false} href={`/u/${f.handle}`}>
                    <strong>{f.name}</strong> <span>@{f.handle}</span>
                  </Link>
                  <p>{f.bio || "A founder with an introduction to share."}</p>
                  <div className="row-details">
                    {f.coordinates ? (
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
        {
          <section className="map-panel" aria-label="Interactive founder map">
            <FounderMap
              founders={mapped}
              places={serverPage?.places}
              initialBounds={serverPage?.query.bounds}
              onViewportChange={
                serverPage
                  ? (bounds) => {
                      if (bounds !== (serverPage.query.bounds ?? ""))
                        router.replace(pageUrl({ bounds, page: 1 }), {
                          scroll: false,
                        });
                    }
                  : undefined
              }
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
        }
      </div>
    </main>
  );
}
