"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  prepareAnalyticsEvent,
  sanitizePostHogEvent,
  type AnalyticsEventName,
  type AnalyticsInput,
  type PostHogEvent,
} from "../lib/analytics-events";

type PostHog = {
  __SV?: number;
  __FOUNDER_DIRECTORY_TEST__?: boolean;
  init: (key: string, options: Record<string, unknown>) => void;
  capture: (
    event: string,
    properties?: Record<string, string | number>,
  ) => void;
};

declare global {
  interface Window {
    posthog?: PostHog;
  }
}

function projectKey() {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  return key && key.startsWith("phc_") ? key : null;
}

function options(token: string) {
  return {
    api_host:
      process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com",
    ui_host: "https://eu.posthog.com",
    person_profiles: "identified_only" as const,
    persistence: "memory" as const,
    autocapture: false,
    // App Router never full-reloads. Send both events ourselves.
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    before_send: (event: PostHogEvent) => sanitizePostHogEvent(event, token),
  };
}

let booted = false;
function testTransport() {
  return (
    document.documentElement.dataset.directoryPreview === "1" &&
    window.posthog?.__FOUNDER_DIRECTORY_TEST__ === true
  );
}

function active() {
  return Boolean(projectKey()) || testTransport();
}

function install() {
  const key = projectKey();
  if (typeof window === "undefined" || booted) return;
  try {
    if (!key && testTransport()) {
      window.posthog?.init("phc_test", options("phc_test"));
      booted = true;
      return;
    }
    if (!key) return;
    if (!window.posthog?.__SV) {
      const snippet = document.createElement("script");
      snippet.text = `!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=\" (stub)\"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once identify reset get_distinct_id".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);`;
      document.head.appendChild(snippet);
    }
    window.posthog?.init(key, options(key));
    booted = true;
  } catch {
    console.warn("Analytics vendor failed during setup");
  }
}

function send(event: "$pageview" | "$pageleave", url: string) {
  try {
    window.posthog?.capture(event, { $current_url: url });
  } catch {
    console.warn(`Analytics vendor failed: ${event}`);
  }
}

function PageViews() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const previousUrl = useRef<string | null>(null);

  useEffect(() => {
    if (!active()) return;
    install();
    const url = window.location.href;
    if (previousUrl.current && previousUrl.current !== url) {
      send("$pageleave", previousUrl.current);
    }
    send("$pageview", url);
    previousUrl.current = url;
  }, [pathname, searchParams]);

  useEffect(() => {
    if (!active()) return;
    const onHide = () => {
      const url = previousUrl.current ?? window.location.href;
      send("$pageleave", url);
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  return null;
}

export function Analytics({ preview = false }: { preview?: boolean }) {
  if (!projectKey() && !preview) return null;
  return (
    <Suspense fallback={null}>
      <PageViews />
    </Suspense>
  );
}

export function capture<E extends AnalyticsEventName>(
  event: E,
  properties: AnalyticsInput<E>,
): void;
export function capture(event: string, properties: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  if (!active()) return;
  const prepared = prepareAnalyticsEvent(event, properties);
  if (!prepared) return;
  try {
    install();
    window.posthog?.capture(prepared.event, prepared.properties);
  } catch {
    console.warn(`Analytics vendor failed: ${prepared.event}`);
  }
}
