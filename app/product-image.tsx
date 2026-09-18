"use client";
import { useState } from "react";
import { safeHttpUrl } from "@/lib/model";
export function ProductImage({
  name,
  imageUrl,
  website,
}: {
  name: string;
  imageUrl: string | null;
  website: string | null;
}) {
  const safeWebsite = safeHttpUrl(website);
  const icon = safeWebsite ? new URL("/favicon.ico", safeWebsite).href : null;
  const sources = [
    ...new Set([safeHttpUrl(imageUrl), icon].filter((s): s is string => !!s)),
  ];
  const [failed, setFailed] = useState<string[]>([]);
  const source = sources.find((s) => !failed.includes(s));
  return (
    <div className="product-image" data-testid="product-image">
      {source ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={source}
          src={source}
          alt={`${name} image`}
          width={600}
          height={315}
          loading="lazy"
          referrerPolicy="no-referrer"
          className={source === icon ? "product-image-icon" : undefined}
          onError={() => setFailed((previous) => [...previous, source])}
        />
      ) : (
        <span
          className="product-image-fallback"
          aria-label={`${name}: image unavailable`}
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
    </div>
  );
}
