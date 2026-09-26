"use client";

import { useEffect, useState } from "react";
import { capture } from "./analytics";

function sessionId() {
  const key = "fd-presence";
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  sessionStorage.setItem(key, id);
  return id;
}

export function OnlineNow() {
  const [online, setOnline] = useState<number | null>(null);

  useEffect(() => {
    const id = sessionId();
    let cancelled = false;
    const beat = async () => {
      try {
        const response = await fetch("/api/presence", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: id }),
          keepalive: true,
        });
        const data = (await response.json()) as { online?: number };
        if (!cancelled && typeof data.online === "number")
          setOnline(data.online);
      } catch {
        if (!cancelled) setOnline((value) => value ?? 0);
      }
    };
    void beat();
    const timer = window.setInterval(() => void beat(), 20_000);
    capture("weft_founder_directory_presence_started", {});
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <p className="online" aria-live="polite">
      <span className="dot" aria-hidden="true" />
      <b>{online === null ? "—" : online}</b>{" "}
      <span className="online-label">online</span>
    </p>
  );
}
