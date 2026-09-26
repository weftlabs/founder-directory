import type { Metadata } from "next";
import type { FounderDnaProfile } from "./founder-dna";
import { SITE_URL } from "./site";

export function founderProfileUrl(profile: Pick<FounderDnaProfile, "handle">) {
  return `${SITE_URL}/u/${encodeURIComponent(profile.handle)}`;
}
export function founderShareImageUrl(profile: FounderDnaProfile) {
  return `${founderProfileUrl(profile)}/share-image?revision=${encodeURIComponent(profile.revision)}`;
}
export function founderShareText(profile: FounderDnaProfile) {
  return `${profile.portrait.shareText}\n\n${founderProfileUrl(profile)}`;
}
export function founderShareMetadata(profile: FounderDnaProfile): Metadata {
  const title = `${profile.name} (@${profile.handle})`;
  const description = profile.portrait.roast.lines[0].text;
  const image = {
    url: founderShareImageUrl(profile),
    width: 1200,
    height: 630,
    alt: `${title}: ${description}`,
  };
  return {
    title,
    description,
    alternates: { canonical: founderProfileUrl(profile) },
    openGraph: {
      title,
      description,
      type: "profile",
      url: founderProfileUrl(profile),
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}
// The bundled image font is Latin-only. Avoid network font fallback for unsupported glyphs.
// The full, unmodified name and text remain on the accessible HTML profile.
export function clipShareText(
  value: string,
  limit: number,
  fallback = "Founder profile",
) {
  const safe =
    value
      .normalize("NFKD")
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, "-")
      .replace(/[^\x20-\x7e]/g, "")
      .replace(/\s+/g, " ")
      .trim() || fallback;
  return safe.length > limit ? `${safe.slice(0, limit - 3)}...` : safe;
}
