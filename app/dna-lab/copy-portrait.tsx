"use client";
import { useRef, useState } from "react";
export function CopyPortrait({ text }: { text: string }) {
  const [draft, setDraft] = useState(text);
  const [status, setStatus] = useState<"ready" | "copied" | "manual">("ready");
  const input = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="portrait-copy">
      <label>
        Your share text · review or edit
        <textarea
          ref={input}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setStatus("ready");
          }}
        />
      </label>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(draft);
            setStatus("copied");
          } catch {
            setStatus("manual");
            input.current?.focus();
            input.current?.select();
          }
        }}
      >
        {status === "copied" ? "Copied ✓" : "Copy text for X ↗"}
      </button>
      <span role="status">
        {status === "copied"
          ? "Ready to paste. Nothing has been posted."
          : status === "manual"
            ? "Text selected. Copy it manually, then paste into X."
            : "Nothing is posted automatically."}
      </span>
    </div>
  );
}
