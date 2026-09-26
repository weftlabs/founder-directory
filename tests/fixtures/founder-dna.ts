import type { FounderDnaProfile } from "../../lib/founder-dna";
/** Entirely fictional and safe for committed UI fixtures. */
export function founderDnaFixture(): FounderDnaProfile {
  return {
    id: "fictional-founder",
    handle: "example",
    name: "Alex Example",
    bio: "Designer building scheduling tools.",
    avatarUrl: null,
    location: null,
    website: null,
    releaseId: "fictional-release-1",
    revision: "fictional-profile-1",
    sourceRevision: "fictional-source-1",
    analysisId: "fictional-analysis-1",
    facets: [
      { key: "venture_domain", value: "productivity", confidence: 0.9 },
      { key: "craft", value: "creative_branding", confidence: 0.9 },
      { key: "building_style", value: "unknown", confidence: 0.8 },
      { key: "founding_role", value: "unknown", confidence: 0.9 },
    ],
    facts: [
      {
        id: "fact-design",
        text: "Alex describes design work.",
        sourceIds: ["source-bio"],
      },
    ],
    sources: [
      {
        id: "source-bio",
        label: "Saved bio",
        kind: "bio",
        url: "https://example.com/alex",
        excerpt: "Designer building scheduling tools.",
      },
    ],
    portrait: {
      analysisId: "fictional-portrait-analysis",
      revision: "fictional-portrait-1",
      recipeVersion: "portrait-v1",
      model: "fictional-model",
      archetype: {
        title: "The calendar whisperer",
        kicker: "Makes room for better work",
        hook: "Even free time gets a design review.",
        summary: "A playful reading of a designer building scheduling tools.",
        tags: ["Design", "Scheduling"],
      },
      roast: {
        title: "A friendly roast",
        lines: [
          {
            text: "The meeting invite probably has a mood board.",
            factIds: ["fact-design"],
          },
        ],
      },
      story: {
        title: "Design meets the calendar",
        before: "Design",
        after: "Scheduling tools",
        connection: "Applying design to everyday coordination.",
      },
      shareText: "My founder DNA: the calendar whisperer.",
      factIds: ["fact-design"],
    },
    products: [],
    connections: [],
  };
}
