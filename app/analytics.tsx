"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type PostHog = {
  __SV?: number;
  init: (key: string, options: Record<string, unknown>) => void;
  capture: (event: string, properties?: Record<string, string>) => void;
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

function options() {
  return {
    api_host:
      process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com",
    ui_host: "https://eu.posthog.com",
    person_profiles: "identified_only" as const,
    // App Router never full-reloads. Send both events ourselves.
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
  };
}

let booted = false;

function install() {
  const key = projectKey();
  if (!key || typeof window === "undefined" || booted) return;
  if (!window.posthog?.__SV) {
    const snippet = document.createElement("script");
    snippet.text = `!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=\" (stub)\"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once identify reset get_distinct_id".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);`;
    document.head.appendChild(snippet);
  }
  window.posthog?.init(key, options());
  booted = true;
}

function send(event: "$pageview" | "$pageleave", url: string) {
  window.posthog?.capture(event, { $current_url: url });
}

function PageViews() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const previousUrl = useRef<string | null>(null);

  useEffect(() => {
    if (!projectKey()) return;
    install();
    const url = window.location.href;
    if (previousUrl.current && previousUrl.current !== url) {
      send("$pageleave", previousUrl.current);
    }
    send("$pageview", url);
    previousUrl.current = url;
  }, [pathname, searchParams]);

  useEffect(() => {
    if (!projectKey()) return;
    const onHide = () => {
      const url = previousUrl.current ?? window.location.href;
      send("$pageleave", url);
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  return null;
}

export function Analytics() {
  if (!projectKey()) return null;
  return (
    <Suspense fallback={null}>
      <PageViews />
    </Suspense>
  );
}

export function capture(event: string, properties?: Record<string, string>) {
  if (!projectKey()) return;
  install();
  window.posthog?.capture(event, properties);
}
