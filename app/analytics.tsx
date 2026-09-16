"use client";

import { useEffect } from "react";

type PostHog = {
  __SV?: number;
  init: (key: string, options: Record<string, unknown>) => void;
  capture: (event: string) => void;
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
    person_profiles: "identified_only",
    capture_pageview: true,
    capture_pageleave: true,
    disable_session_recording: true,
  };
}

function install() {
  const key = projectKey();
  if (!key || typeof window === "undefined") return;
  if (!window.posthog?.__SV) {
    const snippet = document.createElement("script");
    snippet.text = `!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once identify reset get_distinct_id".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);`;
    document.head.appendChild(snippet);
  }
  window.posthog?.init(key, options());
}

export function Analytics() {
  useEffect(() => {
    install();
  }, []);
  return null;
}

export function capture(event: string) {
  if (!projectKey()) return;
  install();
  window.posthog?.capture(event);
}
