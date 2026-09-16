import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFounder } from "@/lib/db";
import { displayLink } from "@/lib/model";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const founder = await getFounder(handle).catch(() => null);
  if (!founder) return { title: "Not found" };
  const description = `${founder.name} (@${founder.handle}) is a solo founder${
    founder.city ? ` in ${founder.city}` : ""
  }. ${founder.bio ?? ""}`;
  return {
    title: `${founder.name} (@${founder.handle})`,
    description,
    alternates: { canonical: `/u/${founder.handle}` },
  };
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const founder = await getFounder(handle).catch(() => null);
  if (!founder) notFound();
  const place = [founder.city, founder.country].filter(Boolean).join(", ");

  return (
    <>
      <header className="top">
        <a className="brand" href="/">
          Solo <em>Founders</em>
        </a>
        <div className="fresh">Profile · public page</div>
      </header>
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
            <h1>
              I'm {founder.name}, I'm a solo founder
            </h1>
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
            {founder.introUrl ? (
              <>
                {"\n"}
                <a href={founder.introUrl}>View on X</a>
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
            <LinkRow
              label="X"
              href={`https://x.com/${founder.handle}`}
            />
            <LinkRow label="Website" href={founder.website} />
            <LinkRow label="GitHub" href={founder.github} />
            <LinkRow label="LinkedIn" href={founder.linkedin} />
          </dl>
        </section>
        <a className="back" href="/">
          ← Directory
        </a>
      </main>
    </>
  );
}

function LinkRow({ label, href }: { label: string; href: string | null }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {href ? (
          <a href={href}>{displayLink(href)}</a>
        ) : (
          <span className="miss">Not found</span>
        )}
      </dd>
    </div>
  );
}
