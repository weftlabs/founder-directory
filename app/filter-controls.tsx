"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { DirectoryFilters, LocationOption } from "@/lib/directory-filters";

export const categoryLabel = (value: string) =>
  value === "Unclear" ? "Uncategorized" : value;

function LocationPicker({
  label,
  current,
  options,
  onSelect,
  onClear,
}: {
  label: string;
  current: string;
  options: LocationOption[];
  onSelect: (option: LocationOption) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const details = useRef<HTMLDetailsElement>(null);
  const id = useId();
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (details.current && !details.current.contains(event.target as Node))
        details.current.open = false;
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  function close() {
    if (!details.current) return;
    details.current.open = false;
    details.current.querySelector("summary")?.focus();
    setQuery("");
  }
  const visible = options.filter((option) =>
    option.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <details
      className="location-picker"
      ref={details}
      onKeyDown={(event) => {
        if (event.key === "Escape" && details.current?.open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
      onToggle={() => {
        if (!details.current?.open) setQuery("");
      }}
    >
      <summary data-active={Boolean(current)} aria-controls={id}>
        <span className="picker-label">{label}</span>
        <span className="picker-value">
          {current || `All ${label === "Country" ? "countries" : "cities"}`}
        </span>
        <span className="picker-chevron" aria-hidden="true">
          ⌄
        </span>
      </summary>
      <div className="picker-panel" id={id}>
        <label className="sr-only" htmlFor={`${id}-search`}>
          Search {label.toLowerCase()} options
        </label>
        <input
          id={`${id}-search`}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Find a ${label.toLowerCase()}…`}
        />
        <div className="picker-options" aria-label={`${label} options`}>
          <button
            type="button"
            aria-pressed={!current}
            onClick={() => {
              onClear();
              close();
            }}
          >
            All {label === "Country" ? "countries" : "cities"}
          </button>
          {visible.map((option) => (
            <button
              type="button"
              key={JSON.stringify([option.value, option.country])}
              aria-pressed={
                current === option.label || current === option.value
              }
              onClick={() => {
                onSelect(option);
                close();
              }}
            >
              <span>{option.label}</span>
              <span className="option-count">{option.count}</span>
            </button>
          ))}
          {!visible.length && (
            <p className="picker-empty">
              No matching {label === "Country" ? "countries" : "cities"}.
            </p>
          )}
        </div>
      </div>
    </details>
  );
}

export function FilterControls({
  filters,
  categories,
  countries,
  cities,
  onChange,
}: {
  filters: DirectoryFilters;
  categories: string[];
  countries: LocationOption[];
  cities: LocationOption[];
  onChange: (changes: Partial<DirectoryFilters>) => void;
}) {
  return (
    <>
      <div className="craft-filter">
        <span className="filter-label">Craft</span>
        <div className="chips" aria-label="Filter by craft">
          {["", ...categories].map((category) => (
            <button
              key={category}
              type="button"
              data-neutral={!category}
              aria-pressed={filters.category === category}
              onClick={() => onChange({ category })}
            >
              {category ? categoryLabel(category) : "All"}
            </button>
          ))}
        </div>
      </div>
      <div className="location-filters">
        <LocationPicker
          label="Country"
          current={filters.country}
          options={countries}
          onClear={() => onChange({ country: "", city: "" })}
          onSelect={(option) => onChange({ country: option.value, city: "" })}
        />
        <LocationPicker
          label="City"
          current={
            filters.city
              ? `${filters.city}, ${filters.country || "Country unknown"}`
              : ""
          }
          options={cities}
          onClear={() => onChange({ city: "" })}
          onSelect={(option) =>
            onChange({ city: option.value, country: option.country ?? "" })
          }
        />
      </div>
    </>
  );
}
