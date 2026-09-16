import type { Metadata } from "next";
import { SiteHeader } from "../site-header";
import { GITHUB_REPO, NITTARAB_X, SITE_URL, WEFTLABS_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "About",
  description:
    "Find founders taking part in the solo founder trend on X, discover what they are building, and connect with them.",
  alternates: { canonical: "/about" },
  openGraph: {
    title: "About Founder Directory",
    description:
      "Find founders taking part in the solo founder trend on X, discover what they are building, and connect with them.",
    url: "/about",
    type: "article",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "AboutPage",
  name: "About Founder Directory",
  url: `${SITE_URL}/about`,
  isPartOf: { "@type": "WebSite", name: "Founder Directory", url: SITE_URL },
};

export default function AboutPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <SiteHeader aboutCurrent />
      <main className="about">
        <p className="cat">About</p>
        <h1>Find the founders taking part in the trend.</h1>
        <p className="lede">
          Founder Directory makes it easier to find the people joining the
          &quot;I&apos;m a solo founder&quot; trend on X and see what
          they&apos;re building, without scrolling through every post.
        </p>

        <h2>Why this exists</h2>
        <p>
          Founders are introducing themselves and sharing their projects on X.
          We wanted a way to browse those introductions in one place, find
          someone again, or discover a founder we hadn&apos;t come across yet.
        </p>
        <p>
          Search the directory or filter by category, city, and country. Open a
          profile to learn more, follow the links to their work, or reach out on
          X.
        </p>
        <p>
          The directory is built from public posts and profiles. It may miss
          people taking part, and a listing isn&apos;t verification of a founder
          or their company.
        </p>

        <h2>How it&apos;s built</h2>
        <p>
          This is an open-source Next.js app powered by Weft. Server-side calls
          find relevant posts, fetch public X profiles, and turn location text
          into city and country filters. Browsing uses the profiles already
          stored in the directory.
        </p>
        <p>
          If you&apos;re building something similar, you can explore the code or
          contribute at{" "}
          <a href={GITHUB_REPO} rel="noopener noreferrer">
            weftlabs/founder-directory
          </a>
          .
        </p>

        <h2>Who built it</h2>
        <p>
          Built by{" "}
          <a href={NITTARAB_X} rel="noopener noreferrer">
            Nittarab
          </a>{" "}
          at{" "}
          <a href={WEFTLABS_URL} rel="noopener noreferrer">
            Weft Labs
          </a>
          .
        </p>
      </main>
    </>
  );
}
