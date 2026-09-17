import type { BuilderDnaExample } from "./builder-dna";
import type { Founder } from "./model";

export function shareImageMetadata(handle: string, name: string) {
  return [
    {
      url: `/u/${encodeURIComponent(handle)}/share-image`,
      width: 1200,
      height: 630,
      alt: `${name} — Founder Directory profile`,
    },
  ];
}

export function clipShareText(value: string, limit: number): string {
  const safe = Array.from(value.normalize("NFKD"))
    .filter((character) => /[\x20-\x7E]/.test(character))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(safe || "Founder profile");
  return chars.length > limit
    ? `${chars.slice(0, limit - 1).join("")}…`
    : chars.join("");
}

export function founderShareData(
  example: BuilderDnaExample | null,
  founder: Founder | null,
) {
  if (example)
    return {
      name: example.name,
      handle: example.handle,
      initials: example.initials,
      headline: example.signature,
      product: example.product,
      tags: [...new Set([...example.craft, ...example.domains])].slice(0, 3),
      note: "Builder DNA · inferred from public sources",
    };
  if (founder)
    return {
      name: founder.name,
      handle: founder.handle,
      initials: Array.from(founder.name).slice(0, 2).join("").toUpperCase(),
      headline: founder.bio || "Meet the person behind the profile.",
      product: null,
      tags: founder.category === "Unclear" ? [] : [founder.category],
      note: "Public founder profile",
    };
  return null;
}
