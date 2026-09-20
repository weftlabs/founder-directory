"use client";
import { useEffect, useRef, useState } from "react";
import { capture } from "./analytics";

export function FounderDnaShare({
  profileId,
  handle,
  profileRevision,
  releaseId,
  text,
  imageUrl,
}: {
  profileId: string;
  handle: string;
  profileRevision: string;
  releaseId: string;
  text: string;
  imageUrl: string;
}) {
  const [draft, setDraft] = useState(text);
  const lastView = useRef("");
  useEffect(() => {
    const view = `${profileId}:${profileRevision}:${releaseId}`;
    if (lastView.current !== view)
      capture("weft_founder_dna_profile_viewed", {
        profile_id: profileId,
        profile_revision: profileRevision,
        release_id: releaseId,
      });
    lastView.current = view;
  }, [profileId, profileRevision, releaseId]);
  const [message, setMessage] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(draft);
      setMessage("Copied. Ready to share.");
      capture("weft_founder_dna_share_copied", {
        profile_id: profileId,
        profile_revision: profileRevision,
        release_id: releaseId,
      });
    } catch {
      setMessage("Copy did not work. Select the text and copy it.");
    }
  }
  return (
    <section className="profile-share" aria-labelledby="founder-share-title">
      <h2 id="founder-share-title">Share this Founder DNA</h2>
      <p>Make someone laugh. Help them find their next connection.</p>
      <label htmlFor="founder-share-draft">Your share draft</label>
      <textarea
        id="founder-share-draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={4}
      />
      <div className="dna-share-actions">
        <button type="button" onClick={copy}>
          Copy text and profile link
        </button>
        <a
          href={imageUrl}
          download={`${handle}-founder-dna.png`}
          onClick={() =>
            capture("weft_founder_dna_image_download_started", {
              profile_id: profileId,
              profile_revision: profileRevision,
              release_id: releaseId,
            })
          }
        >
          Download image
        </a>
      </div>
      <p role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
