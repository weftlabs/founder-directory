import type { Metadata } from "next";
import { SiteHeader } from "../site-header";
import { NITTARAB_X, SITE_URL, WEFTLABS_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "About",
  description:
    "How an X intro trend became Founder Directory, with server-side Weft calls powering profile discovery and location normalization.",
  alternates: { canonical: "/about" },
  openGraph: {
    title: "About Founder Directory",
    description:
      "The I'm a solo founder wave on X, kept as a searchable index, built with Weft.",
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
        <h1>The feed moved on. The people did not.</h1>
        <p className="lede">
          Founder Directory is a public index of people who posted I&apos;m a
          solo founder on X. It exists because a trend is a terrible database.
        </p>

        <h2>The X phenomenon</h2>
        <p>
          For a stretch, X filled with the same intro. I&apos;m a solo founder.
          Someone posted a template. Others quoted it, named what they were
          building, and dropped a handle. It felt like a roll call.
        </p>
        <p>
          Then the timeline did what timelines do. New posts buried the old
          ones. Quote chains are a bad way to find a designer in Berlin or a
          hardware person in Austin two weeks later.
        </p>
        <p>
          We kept the public intros. Search by craft, city, or country. Each
          person gets a stable <code>/u/handle</code> page that search engines
          can actually index. The row is an intro plus public profile signals,
          not a claim that we verified the company.
        </p>

        <h2>Why Weft</h2>
        <p>
          We built this to show what Weft is for. Not a protocol demo. A service
          people can use.
        </p>
        <p>
          A directory like this is several jobs glued together. Find the intro
          posts. Hydrate an X profile. Turn messy location strings into city and
          country. Tomorrow it might also pull a LinkedIn URL, a GitHub repo, or
          another social graph. The usual path is a new vendor integration for
          each of those.
        </p>
        <p>
          Weft is one controlled way for an app to discover, choose, pay for,
          and call those capabilities, then keep going. This site is a Next.js
          app. The hops run on the server. The directory does not show receipts
          or prices. Weft is the plumbing that made it cheap to compose X with
          other APIs instead of becoming an X-API company.
        </p>
        <p>
          That is the point we wanted people to see. You can ship a real project
          website (a directory, an index, a small tool) by combining social
          surfaces and paid APIs without wiring each provider by hand. X today.
          LinkedIn or GitHub when the job needs them. Same pattern.
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
