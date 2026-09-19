import type { Metadata } from "next";
import { cache } from "react";
import { loadFounderDnaProfile } from "@/lib/founder-dna-data";
import { founderShareMetadata } from "@/lib/founder-share";
import { FounderDnaProfileView } from "../../founder-dna-profile";
import Link from "next/link";
import { SiteHeader } from "../../site-header";
import { notFound } from "next/navigation";
import { getFounder } from "@/lib/db";
import { loadLocalProductFounder } from "@/lib/product-snapshot";
import { LocalProductProfile } from "../../local-product-profile";
import { displayLink, safeHttpUrl } from "@/lib/model";

export const dynamic = "force-dynamic";
const readDnaProfile = cache(loadFounderDnaProfile);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const dna = await readDnaProfile(handle);
  if (dna.status === "ready") return founderShareMetadata(dna.profile);
  if (dna.status !== "disabled")
    return {
      title:
        dna.status === "unavailable"
          ? "Profile temporarily unavailable"
          : "Not found",
      robots: { index: false, follow: false },
    };
  if (process.env.PRODUCTS_LOCAL_SNAPSHOT) {
    const founder = await loadLocalProductFounder(handle);
    return {
      title: founder?.name ?? "Founder profile",
      robots: { index: false, follow: false },
    };
  }
  const founder = await getFounder(handle).catch(() => null);
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
    },
    twitter: {
      card: "summary",
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
  const dna = await readDnaProfile(handle);
  if (dna.status === "ready")
    return <FounderDnaProfileView profile={dna.profile} />;
  if (dna.status === "unavailable")
    return (
      <>
        <SiteHeader />
        <main className="profile">
          <h1>Profile temporarily unavailable</h1>
          <p>Please try again later.</p>
          <Link href="/directory">Find founders</Link>
        </main>
      </>
    );
  if (dna.status !== "disabled") notFound();
  if (process.env.PRODUCTS_LOCAL_SNAPSHOT) {
    const founder = await loadLocalProductFounder(handle);
    if (!founder) notFound();
    return <LocalProductProfile founder={founder} />;
  }
  const founder = await getFounder(handle).catch(() => null);
  if (!founder) notFound();
  const place = [founder.city, founder.country].filter(Boolean).join(", ");
  const introUrl = safeHttpUrl(founder.introUrl);

  return (
    <>
      <SiteHeader />
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
        <Link className="back" href="/directory">
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
