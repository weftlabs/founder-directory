"use client";
import { useEffect, useRef, useState } from "react";

/** Avatar with an initials fallback; saved X image links often expire. */
export function FounderAvatar({
  src,
  initials,
}: {
  src: string | null;
  initials: string;
}) {
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  // A server-rendered image can fail before hydration attaches onError.
  useEffect(() => {
    const el = image.current;
    if (el && el.complete && el.naturalWidth === 0) setFailed(true);
  }, []);
  if (!src || failed)
    return (
      <span className="dna-initials" aria-hidden="true">
        {initials}
      </span>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={image}
      src={src}
      alt=""
      width={64}
      height={64}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
