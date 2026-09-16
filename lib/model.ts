export type VibeSignal = { id: string; hit: boolean; text: string };
export type VibeCheck = { score: number; label: string; signals: VibeSignal[] };

export type Founder = {
  handle: string;
  name: string;
  bio: string | null;
  website: string | null;
  github: string | null;
  linkedin: string | null;
  city: string | null;
  country: string | null;
  location: string | null;
  avatarUrl: string | null;
  category: string;
  vibe: VibeCheck;
  introText: string | null;
  updatedAt: string | null;
};

export function extractGithub(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(
    /(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)/i,
  );
  return match?.[1] ? `https://github.com/${match[1]}` : null;
}

export function extractLinkedin(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(
    /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/([A-Za-z0-9_-]+)/i,
  );
  return match ? `https://www.linkedin.com/in/${match[1]}` : null;
}

export function splitLocation(raw: string | null): {
  city: string | null;
  country: string | null;
} {
  if (!raw) return { city: null, country: null };
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return { city: parts[0], country: parts.slice(1).join(", ") };
  }
  return { city: parts[0] ?? null, country: null };
}

export function categorize(input: {
  bio: string | null;
  website: string | null;
  github: string | null;
  professional: string | null;
}): string {
  const text = `${input.bio ?? ""} ${input.professional ?? ""}`.toLowerCase();
  if (/\bstealth\b/.test(text) && !input.website) return "Stealth";
  if (/\b(infra|agent|protocol|api|x402)\b/.test(text)) return "Infra";
  if (input.github || /\b(open.?source|oss|devtools|eval|local-first)\b/.test(text)) {
    return "Tools";
  }
  if (/\b(app|consumer|community|club|design)\b/.test(text)) return "Consumer";
  if (/\b(founder|building|shipping)\b/.test(text)) return "Infra";
  return "Unclear";
}

export function scoreVibe(input: {
  bio: string | null;
  website: string | null;
  github: string | null;
  professional: string | null;
  protected: boolean;
  tweets: number | null;
}): VibeCheck {
  const bio = input.bio ?? "";
  const founderLanguage =
    /\b(solo founder|co-?founder|founder|building|indie hacker|stealth|shipping)\b/i.test(
      bio,
    );
  const signals: VibeSignal[] = [
    {
      id: "language",
      hit: founderLanguage,
      text: founderLanguage
        ? "Bio talks like a founder"
        : "Bio does not say founder / building",
    },
    {
      id: "website",
      hit: Boolean(input.website),
      text: input.website ? "Has a public website" : "No website on the profile",
    },
    {
      id: "github",
      hit: Boolean(input.github),
      text: input.github ? "GitHub in the open" : "No GitHub URL in the bio",
    },
    {
      id: "professional",
      hit: Boolean(input.professional),
      text: input.professional
        ? `X professional: ${input.professional}`
        : "No professional category",
    },
    {
      id: "open",
      hit: !input.protected,
      text: input.protected ? "Protected account" : "Public account",
    },
    {
      id: "posts",
      hit: (input.tweets ?? 0) >= 20,
      text:
        (input.tweets ?? 0) >= 20
          ? "Has a posting history"
          : "Thin posting history",
    },
  ];
  const score = Math.min(
    100,
    signals.reduce((sum, signal) => {
      if (!signal.hit) return sum;
      if (signal.id === "language") return sum + 40;
      if (signal.id === "website" || signal.id === "professional") return sum + 15;
      return sum + 10;
    }, 0),
  );
  const label =
    score >= 70
      ? "Solo founder energy"
      : score >= 40
        ? "Builder"
        : "Weak founder signal";
  return { score, label, signals };
}

export function parseHandle(value: string): string {
  const trimmed = value.trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(trimmed)) {
    throw new TypeError("Invalid handle");
  }
  return trimmed;
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "not yet";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 1) return "just now";
  if (min === 1) return "1 min ago";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr === 1) return "1 hour ago";
  return `${hr} hours ago`;
}

export function displayLink(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "");
}
