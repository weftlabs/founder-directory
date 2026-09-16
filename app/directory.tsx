"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { FilterControls, categoryLabel } from "./filter-controls";
import {
  emptyFilters,
  locationOptions,
  matchesSearch,
  readFilters,
  writeFilters,
  type DirectoryFilters,
} from "@/lib/directory-filters";
import {
  DIRECTORY_PREFETCH_ROOT_MARGIN,
  appendDirectoryPage,
  emptyDirectoryPage,
  type DirectoryPage,
} from "@/lib/directory-page";
import type { Founder } from "@/lib/model";

function subscribe(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener("directory-filters", callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("directory-filters", callback);
  };
}
const getSearch = () => window.location.search;

export function Directory({
  founders,
  scanned,
  initialPage,
  initialSearch = "",
}: {
  founders?: Founder[];
  scanned: string;
  initialPage?: DirectoryPage;
  initialSearch?: string;
}) {
  const preview = founders !== undefined;
  const search = useSyncExternalStore(
    subscribe,
    getSearch,
    () => initialSearch,
  );
  const filters = useMemo(
    () => readFilters(search, preview ? founders : undefined),
    [search, founders, preview],
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const fetchedKey = useRef(initialSearch.replace(/^\?/, ""));
  const [live, setLive] = useState<DirectoryPage>(
    initialPage ?? emptyDirectoryPage(),
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMoreInFlight = useRef(false);
  const prefetch = useRef<{
    key: string;
    cursor: string;
    promise: Promise<DirectoryPage | null>;
  } | null>(null);
  const previewCategories = useMemo(
    () => unique((founders ?? []).map((f) => f.category)),
    [founders],
  );
  const previewLocations = useMemo(
    () => locationOptions(founders ?? [], filters),
    [founders, filters],
  );
  const categories = preview ? previewCategories : live.categories;
  const countries = preview ? previewLocations.countries : live.countries;
  const cities = preview ? previewLocations.cities : live.cities;
  const activeCount = Object.values(filters).filter(Boolean).length;
  function update(changes: Partial<DirectoryFilters>, replace = false) {
    const next = {
      ...readFilters(window.location.search, preview ? founders : undefined),
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
  const previewRows = founders
    ? founders.filter(
        (f) =>
          (!filters.category || f.category === filters.category) &&
          (!filters.country || f.country === filters.country) &&
          (!filters.city || f.city === filters.city) &&
          matchesSearch(f, filters.q),
      )
    : [];
  const rows = preview ? previewRows : live.founders;
  const total = preview ? previewRows.length : live.total;
  const controls = { filters, categories, countries, cities, onChange: update };

  const loadMore = useCallback(async () => {
    if (preview || !live.nextCursor || loadMoreInFlight.current) return;
    const key = writeFilters("", filters);
    const cursor = live.nextCursor;
    loadMoreInFlight.current = true;
    const pending = prefetch.current;
    const waiting = !(
      pending &&
      pending.key === key &&
      pending.cursor === cursor
    );
    if (waiting) setLoadingMore(true);
    try {
      const query = `${key ? `${key}&` : ""}cursor=${encodeURIComponent(cursor)}`;
      let page =
        pending && pending.key === key && pending.cursor === cursor
          ? await pending.promise
          : null;
      if (!page) {
        const response = await fetch(`/api/founders?${query}`);
        page = response.ok ? ((await response.json()) as DirectoryPage) : null;
      }
      if (!page) return;
      prefetch.current = null;
      setLive((current) =>
        appendDirectoryPage(current, page, key, fetchedKey.current),
      );
    } catch {
      // Keep the rows already on screen.
    } finally {
      loadMoreInFlight.current = false;
      setLoadingMore(false);
    }
  }, [filters, live.nextCursor, preview]);

  useEffect(() => {
    if (preview) return;
    const key = writeFilters("", filters);
    if (key === fetchedKey.current) return;
    const previous = new URLSearchParams(fetchedKey.current);
    const qOnly =
      filters.q !== (previous.get("q") ?? "") &&
      filters.category === (previous.get("category") ?? "") &&
      filters.country === (previous.get("country") ?? "") &&
      filters.city === (previous.get("city") ?? "");
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => {
        fetch(`/api/founders${key ? `?${key}` : ""}`, {
          signal: controller.signal,
        })
          .then(async (response) => {
            if (!response.ok) throw new Error("directory page failed");
            return (await response.json()) as DirectoryPage;
          })
          .then((page) => {
            fetchedKey.current = key;
            setLive(page);
          })
          .catch((error: unknown) => {
            if (controller.signal.aborted) return;
            if (error instanceof DOMException && error.name === "AbortError")
              return;
            fetchedKey.current = key;
            setLive(emptyDirectoryPage());
          });
      },
      qOnly ? 200 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [filters, preview]);

  useEffect(() => {
    if (preview || !live.nextCursor) {
      prefetch.current = null;
      return;
    }
    const key = writeFilters("", filters);
    const cursor = live.nextCursor;
    if (prefetch.current?.key === key && prefetch.current.cursor === cursor)
      return;
    const controller = new AbortController();
    const query = `${key ? `${key}&` : ""}cursor=${encodeURIComponent(cursor)}`;
    prefetch.current = {
      key,
      cursor,
      promise: fetch(`/api/founders?${query}`, { signal: controller.signal })
        .then(async (response) =>
          response.ok ? ((await response.json()) as DirectoryPage) : null,
        )
        .catch(() => null),
    };
    return () => {
      if (loadMoreInFlight.current && prefetch.current?.cursor === cursor)
        return;
      controller.abort();
    };
  }, [filters, live.nextCursor, preview]);

  useEffect(() => {
    if (preview || !live.nextCursor || !sentinel.current) return;
    const node = sentinel.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: DIRECTORY_PREFETCH_ROOT_MARGIN },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore, live.nextCursor, preview, rows.length]);

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
          {total} founders
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
            Show {total} {total === 1 ? "result" : "results"}
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
        {total} founders found
      </p>
      {rows.length === 0 ? (
        <p className="empty">No one matches that filter.</p>
      ) : (
        <div className="grid">
          {rows.map((p) => (
            <Link
              className="card"
              href={`/u/${p.handle}`}
              key={p.handle}
              prefetch={false}
            >
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
      {!preview && live.nextCursor ? (
        <div className="load-more">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
          <div ref={sentinel} aria-hidden="true" />
        </div>
      ) : null}
    </main>
  );
}

function unique(values: string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}
