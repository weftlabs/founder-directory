import { notFound } from "next/navigation";
import type { FounderDnaProfile } from "@/lib/founder-dna";
import { FounderConnections } from "../founder-connections";
import { FounderDnaProfileView } from "../founder-dna-profile";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

const profile: FounderDnaProfile = {
  id: "11111111-1111-4111-8111-111111111111",
  handle: "fictional_founder",
  name: "Alex Example",
  bio: "A fictional founder building calm scheduling tools.",
  avatarUrl: null,
  location: "Example City",
  website: null,
  releaseId: "22222222-2222-4222-8222-222222222222",
  revision: "profile-revision-1",
  sourceRevision: "source-revision-1",
  analysisId: "33333333-3333-4333-8333-333333333333",
  facets: [
    { key: "venture_domain", value: "productivity", confidence: 1 },
    { key: "craft", value: "creative_branding", confidence: 1 },
    { key: "building_style", value: "unknown", confidence: 1 },
    { key: "founding_role", value: "solo", confidence: 1 },
  ],
  facts: [
    {
      id: "fictional-fact-1",
      text: "The fictional founder builds scheduling tools.",
      sourceIds: ["fictional-source-1"],
    },
  ],
  sources: [
    {
      id: "fictional-source-1",
      label: "Fictional saved bio",
      kind: "bio",
      url: "https://example.test/source",
      excerpt: "I build calm scheduling tools for small teams.",
    },
  ],
  portrait: {
    analysisId: "44444444-4444-4444-8444-444444444444",
    revision: "portrait-revision-1",
    recipeVersion: "fictional-recipe-1",
    model: "fictional-model",
    archetype: {
      title: "The calendar whisperer",
      kicker: "Makes room for better work",
      hook: "Even free time gets a design review.",
      summary: "A playful portrait made from fictional test data.",
      tags: ["Design", "Scheduling"],
    },
    roast: {
      title: "A friendly roast",
      lines: [
        {
          text: "The meeting invite probably has a mood board.",
          factIds: ["fictional-fact-1"],
        },
      ],
    },
    story: {
      title: "Design meets the calendar",
      before: "Design",
      after: "Scheduling tools",
      connection: "Applying design to everyday coordination.",
    },
    shareText: "My fictional Founder DNA: the calendar whisperer.",
    factIds: ["fictional-fact-1"],
  },
  products: [],
  connections: [
    {
      id: "55555555-5555-4555-8555-555555555555",
      relation: "related_work",
      reason: "Both fictional founders build tools for calm coordination.",
      founder: {
        id: "66666666-6666-4666-8666-666666666666",
        handle: "fictional_neighbor",
        name: "Robin Example",
        avatarUrl: null,
        headline: "Fictional collaboration tools",
        revision: "neighbor-revision-1",
      },
      sourceIds: ["fictional-connection-source-1"],
      sources: [
        {
          id: "fictional-connection-source-1",
          label: "Fictional saved bio",
          kind: "bio",
          url: "https://example.test/connection-source",
          excerpt: "I make collaboration calmer for small teams.",
        },
      ],
    },
  ],
};

export default function FounderDnaPreview() {
  if (process.env.DIRECTORY_PREVIEW !== "1") notFound();
  return (
    <FounderDnaProfileView
      profile={profile}
      connections={
        <FounderConnections
          connections={profile.connections}
          founderId={profile.id}
          profileRevision={profile.revision}
          releaseId={profile.releaseId}
        />
      }
    />
  );
}
