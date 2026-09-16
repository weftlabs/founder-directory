import { notFound } from "next/navigation";
import { Directory } from "../directory";
import { SiteHeader } from "../site-header";
import type { Founder } from "@/lib/model";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

// Explicit opt-in for local UI review and isolated browser tests only.
export default function FilterPreview() {
  if (process.env.DIRECTORY_PREVIEW !== "1") notFound();
  const examples = [
    [
      "Alex Example",
      "Berlin",
      "Germany",
      "Infra",
      "Building infrastructure for small teams.",
    ],
    [
      "Sam Example",
      "Berlin",
      "Germany",
      "Tools",
      "Making a local-first writing tool.",
    ],
    [
      "Robin Example",
      "Munich",
      "Germany",
      "Consumer",
      "Building a community for independent makers.",
    ],
    [
      "Morgan Example",
      "Paris",
      "France",
      "Tools",
      "Open-source tools for creative projects.",
    ],
    [
      "Taylor Example",
      "London",
      "United Kingdom",
      "Consumer",
      "A simpler way to plan weekends with friends.",
    ],
    [
      "Casey Example",
      "Austin",
      "United States",
      "Infra",
      "APIs for bootstrapped businesses.",
    ],
    [
      "Jordan Example",
      "Paris",
      "United States",
      "Unclear",
      "Working on something new.",
    ],
    [
      "Jamie Example",
      "Singapore",
      "Singapore",
      "Tools",
      "Helping developers debug their apps.",
    ],
    [
      "Drew Example",
      "Toronto",
      "Canada",
      "Consumer",
      "An app for the neighborhood.",
    ],
  ];
  const founders: Founder[] = examples.map(
    ([name, city, country, category, bio], i) => ({
      name,
      city,
      country,
      category,
      bio,
      handle: `demo_${i}`,
      location: `${city}, ${country}`,
      website: null,
      github: null,
      linkedin: null,
      avatarUrl: null,
      introText: null,
      introUrl: null,
      updatedAt: null,
      vibe: { score: 0, label: "Demo profile", signals: [] },
    }),
  );
  return (
    <>
      <SiteHeader />
      <p style={{ padding: "12px 24px", color: "#d8ff3e" }}>
        Local filter preview · fictional sample profiles · no live data or paid
        calls
      </p>
      <Directory founders={founders} scanned="just now" />
    </>
  );
}
