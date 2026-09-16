import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "../../site-header";
import { notFound } from "next/navigation";
import { displayLink, safeHttpUrl } from "@/lib/model";
import { getBuilderDnaExample } from "@/lib/builder-dna-local";
import { BuilderDnaProfile } from "../../builder-dna-profile";
import { SITE_URL } from "@/lib/site";
import { shareImageMetadata } from "@/lib/founder-share";
import { getProfileFounder } from "@/lib/profile-founder";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const example = await getBuilderDnaExample(handle);
  if (example) {
    const title = `${example.name} (@${example.handle}) · ${example.product}`;
    const description = example.summary;
    return {
      title,
      description,
      alternates: { canonical: `/u/${example.handle}` },
      openGraph: {
        title,
        description,
        url: `/u/${example.handle}`,
        type: "profile",
        images: shareImageMetadata(example.handle, example.name),
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: shareImageMetadata(example.handle, example.name),
      },
      // Local research is not ready for indexing. Production profiles retain their existing policy.
      robots: { index: false, follow: false },
    };
  }
  const founder = await getProfileFounder(handle).catch(() => null);
  if (!founder) return { title: "Not found" };
  const description = `${founder.name} (@${founder.handle}) is listed in Founder Directory${
    founder.city ? ` in ${founder.city}` : ""
  }. ${founder.bio ?? ""}`;
  return {
    title: `${founder.name} (@${founder.handle})`,
    description,
    alternates: { canonical: `/u/${founder.handle}` },
    openGraph: {
      title: `${founder.name} (@${founder.handle})`,
      description,
      url: `/u/${founder.handle}`,
      type: "profile",
      images: shareImageMetadata(founder.handle, founder.name),
    },
    twitter: {
      card: "summary_large_image",
      images: shareImageMetadata(founder.handle, founder.name),
      title: `${founder.name} (@${founder.handle})`,
      description,
    },
  };
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const example = await getBuilderDnaExample(handle);
  if (example) {
    const canonical = `${SITE_URL}/u/${example.handle}`;
    const structuredData = {
      "@context": "https://schema.org",
      "@type": "ProfilePage",
      url: canonical,
      name: `${example.name} · ${example.product}`,
      description: example.summary,
      mainEntity: {
        "@type": "Person",
        "@id": `${canonical}#person`,
        name: example.name,
        alternateName: `@${example.handle}`,
        url: canonical,
        sameAs: [`https://x.com/${example.handle}`],
      },
    };
    return (
      <>
        <SiteHeader />
        <main className="profile">
          <p className="fresh">Local research preview · saved public sources</p>
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
            }}
          />
          <BuilderDnaProfile example={example} />
        </main>
      </>
    );
  }
  const founder = await getProfileFounder(handle).catch(() => null);
  if (!founder) notFound();
  const place = [founder.city, founder.country].filter(Boolean).join(", ");
  const introUrl = safeHttpUrl(founder.introUrl);

  return (
    <>
      <SiteHeader aside={<div className="fresh">Profile · public page</div>} />
      <main className="profile">
        <div className="hero-row">
          {founder.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={founder.avatarUrl} alt="" width={96} height={96} />
          ) : (
            <div />
          )}
          <div>
            <p className="cat">{founder.category}</p>
            <h1>{founder.name}</h1>
            <p className="handle">
              @{founder.handle}
              {place ? ` · ${place}` : ""}
            </p>
          </div>
        </div>
        {founder.bio ? <p className="bio">{founder.bio}</p> : null}
        {founder.introText ? (
          <blockquote className="tweet">
            {founder.introText}
            {introUrl ? (
              <>
                {"\n"}
                <a href={introUrl}>View on X</a>
              </>
            ) : null}
          </blockquote>
        ) : null}
        <section className="panel">
          <h2>Vibe check</h2>
          <div className="score">
            <b>{founder.vibe.score}</b>
            <span>{founder.vibe.label}</span>
          </div>
          <ul className="signals">
            {founder.vibe.signals.map((signal) => (
              <li key={signal.id} data-hit={String(signal.hit)}>
                {signal.text}
              </li>
            ))}
          </ul>
        </section>
        <section className="panel">
          <h2>Public links</h2>
          <dl>
            <LinkRow label="X" href={`https://x.com/${founder.handle}`} />
            <LinkRow label="Website" href={founder.website} />
            <LinkRow label="GitHub" href={founder.github} />
            <LinkRow label="LinkedIn" href={founder.linkedin} />
          </dl>
        </section>
        <Link className="back" href="/">
          ← Directory
        </Link>
      </main>
    </>
  );
}

function LinkRow({ label, href }: { label: string; href: string | null }) {
  const safeUrl = safeHttpUrl(href);
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {safeUrl ? (
          <a href={safeUrl}>{displayLink(safeUrl)}</a>
        ) : (
          <span className="miss">Not found</span>
        )}
      </dd>
    </div>
  );
}
