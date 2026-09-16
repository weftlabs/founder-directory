import { getFounder, getFounderReadOnly } from "./db";
import type { Founder } from "./model";

const previewFounder: Founder = {
  handle: "fixture_founder",
  name: "示例 Founder 🚀",
  bio: "A synthetic founder used only for offline profile verification. 示例",
  website: "https://example.com",
  github: null,
  linkedin: null,
  city: "Example City",
  country: "Example Country",
  location: "Example City, Example Country",
  avatarUrl: null,
  category: "Tools",
  introText: null,
  introUrl: null,
  updatedAt: "2026-09-16T00:00:00.000Z",
  vibe: { score: 0, label: "Preview fixture", signals: [] },
};

/** Keeps the ordinary database-backed profile path testable without credentials. */
export async function getProfileFounder(handle: string) {
  if (
    process.env.DIRECTORY_PREVIEW === "1" &&
    handle.toLowerCase() === previewFounder.handle
  )
    return previewFounder;
  return getFounder(handle);
}

export async function getProfileFounderReadOnly(handle: string) {
  if (
    process.env.DIRECTORY_PREVIEW === "1" &&
    handle.toLowerCase() === previewFounder.handle
  )
    return previewFounder;
  return getFounderReadOnly(handle);
}
