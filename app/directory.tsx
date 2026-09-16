"use client";

import { useMemo, useRef, useSyncExternalStore } from "react";
import { FilterControls, categoryLabel } from "./filter-controls";
import {
  emptyFilters,
  locationOptions,
  matchesSearch,
  readFilters,
  writeFilters,
  type DirectoryFilters,
} from "@/lib/directory-filters";

function subscribe(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener("directory-filters", callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("directory-filters", callback);
  };
}
const getSearch = () => window.location.search;
const getServerSearch = () => "";
import Link from "next/link";
import type { Founder } from "@/lib/model";

export function Directory({
  founders,
  scanned,
}: {
  founders: Founder[];
  scanned: string;
}) {
  const search = useSyncExternalStore(subscribe, getSearch, getServerSearch);
  const filters = useMemo(
    () => readFilters(search, founders),
    [search, founders],
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const categories = useMemo(
    () => unique(founders.map((f) => f.category)),
    [founders],
  );
  const { countries, cities } = useMemo(
    () => locationOptions(founders, filters),
    [founders, filters],
  );
  const activeCount = Object.values(filters).filter(Boolean).length;
  function update(changes: Partial<DirectoryFilters>, replace = false) {
    const next = {
      ...readFilters(window.location.search, founders),
      ...changes,
    };
    const params = writeFilters(window.location.search, next);
    const url = `${window.location.pathname}${params ? `?${params}` : ""}${window.location.hash}`;
    if (
      url ===
      `${window.location.pathname}${window.location.search}${window.location.hash}`
    )
      return;
    window.history[replace ? "replaceState" : "pushState"](
      window.history.state,
      "",
      url,
    );
    window.dispatchEvent(new Event("directory-filters"));
  }
  const rows = founders.filter(
    (f) =>
      (!filters.category || f.category === filters.category) &&
      (!filters.country || f.country === filters.country) &&
      (!filters.city || f.city === filters.city) &&
      matchesSearch(f, filters.q),
  );
  const controls = { filters, categories, countries, cities, onChange: update };

  return (
    <main className="dir">
      <h1 className="hero">Find the people building.</h1>
      <p className="lede">
        Each founder has a public profile page. Search by name, city, or
        country, then open a card.
      </p>
      <div className="search">
        <input
          aria-label="Search founders"
          type="search"
          value={filters.q}
          onChange={(e) => update({ q: e.target.value }, true)}
          placeholder="Search name, handle, city, or country"
        />
        <span className="count">
          {rows.length} founders
          <span className="updated">
            Updated <b>{scanned}</b>
          </span>
        </span>
      </div>
      <div className="desktop-filters">
        <FilterControls {...controls} />
      </div>
      <button
        className="mobile-filter-trigger"
        ref={filterTrigger}
        type="button"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        <span aria-hidden="true">☷</span> Filters ({activeCount})
      </button>
      <dialog
        ref={dialog}
        className="filter-dialog"
        aria-labelledby="filter-dialog-title"
        onClose={() => filterTrigger.current?.focus()}
      >
        <div className="filter-dialog-header">
          <div>
            <span className="filter-label">Refine the directory</span>
            <h2 id="filter-dialog-title">Filters</h2>
          </div>
          <button
            type="button"
            className="dialog-close"
            aria-label="Close filters"
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
        </div>
        <FilterControls {...controls} />
        <div className="filter-dialog-footer">
          <button
            type="button"
            className="clear-filters"
            disabled={!activeCount}
            onClick={() => update(emptyFilters)}
          >
            Clear filters
          </button>
          <button
            className="show-results"
            type="button"
            onClick={() => dialog.current?.close()}
          >
            Show {rows.length} {rows.length === 1 ? "result" : "results"}
          </button>
        </div>
      </dialog>
      {activeCount > 0 && (
        <div className="active-filters" aria-label="Active filters">
          {(Object.entries(filters) as [keyof DirectoryFilters, string][])
            .filter(([, value]) => value)
            .map(([key, value]) => (
              <button
                type="button"
                className="active-filter"
                key={key}
                aria-label={`Remove ${key} filter: ${key === "category" ? categoryLabel(value) : value}`}
                onClick={() =>
                  update(
                    key === "country"
                      ? { country: "", city: "" }
                      : { [key]: "" },
                  )
                }
              >
                <span>
                  {key === "q"
                    ? `Search: ${value}`
                    : key === "category"
                      ? categoryLabel(value)
                      : value}
                </span>
                <span aria-hidden="true">×</span>
              </button>
            ))}
          <button
            className="clear-filters"
            type="button"
            onClick={() => update(emptyFilters)}
          >
            Clear filters
          </button>
        </div>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {rows.length} founders found
      </p>
      {rows.length === 0 ? (
        <p className="empty">No one matches that filter.</p>
      ) : (
        <div className="grid">
          {rows.map((p) => (
            <Link className="card" href={`/u/${p.handle}`} key={p.handle}>
              <div className="card-top">
                {p.avatarUrl ? (
                  // Remote avatars use their intrinsic size, without an image proxy.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.avatarUrl} alt="" width={56} height={56} />
                ) : (
                  <span
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: "50%",
                      background: "#2c2e28",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    {p.name.slice(0, 1)}
                  </span>
                )}
                <div>
                  <div className="cat">
                    {categoryLabel(p.category)} · {p.vibe.label}
                  </div>
                  <h2>{p.name}</h2>
                  <div className="handle">
                    @{p.handle}
                    {p.city ? ` · ${p.city}` : ""}
                    {p.country ? `, ${p.country}` : ""}
                  </div>
                </div>
              </div>
              <p>{p.bio}</p>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

function unique(values: string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}
