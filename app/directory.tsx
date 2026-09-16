"use client";

import { useMemo, useState } from "react";
import type { Founder } from "@/lib/model";

export function Directory({
  founders,
  scanned,
}: {
  founders: Founder[];
  scanned: string;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [country, setCountry] = useState("All");
  const [city, setCity] = useState("All");

  const cats = useMemo(
    () => ["All", ...unique(founders.map((f) => f.category))],
    [founders],
  );
  const countries = useMemo(
    () => ["All", ...unique(founders.map((f) => f.country).filter(Boolean) as string[])],
    [founders],
  );
  const cities = useMemo(() => {
    const pool = founders.filter(
      (f) => country === "All" || f.country === country,
    );
    return ["All", ...unique(pool.map((f) => f.city).filter(Boolean) as string[])];
  }, [founders, country]);

  const rows = founders.filter((f) => {
    if (cat !== "All" && f.category !== cat) return false;
    if (country !== "All" && f.country !== country) return false;
    if (city !== "All" && f.city !== city) return false;
    const hay = [
      f.name,
      f.handle,
      f.bio,
      f.city,
      f.country,
      f.location,
      f.category,
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  return (
    <main className="dir">
      <h1 className="hero">Find the people doing the intro.</h1>
      <p className="lede">
        Each founder has a public profile page. Search by name, city, or
        country, then open a card.
      </p>
      <div className="search">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, handle, city, or country"
        />
        <span className="count">{rows.length} founders</span>
      </div>
      <div className="filters">
        <span className="label">Craft</span>
        <ChipRow values={cats} current={cat} onChange={setCat} />
      </div>
      <div className="filters">
        <span className="label">Country</span>
        <ChipRow
          values={countries}
          current={country}
          onChange={(value) => {
            setCountry(value);
            setCity("All");
          }}
        />
      </div>
      <div className="filters">
        <span className="label">City</span>
        <ChipRow values={cities} current={city} onChange={setCity} />
      </div>
      {rows.length === 0 ? (
        <p className="empty">No one matches that filter.</p>
      ) : (
        <div className="grid">
          {rows.map((p) => (
            <a className="card" href={`/u/${p.handle}`} key={p.handle}>
              <div className="card-top">
                {p.avatarUrl ? (
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
                    {p.category} · {p.vibe.label}
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
            </a>
          ))}
        </div>
      )}
      <p className="fresh" style={{ marginTop: 24 }}>
        Directory · updated <b>{scanned}</b>
      </p>
    </main>
  );
}

function unique(values: string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function ChipRow({
  values,
  current,
  onChange,
}: {
  values: string[];
  current: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="chips">
      {values.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={value === current}
          onClick={() => onChange(value)}
        >
          {value}
        </button>
      ))}
    </div>
  );
}
