"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Keep exactly one canonical link and one copy of each icon link in the head.
 *
 * Next 16.4 leaves the previous route's metadata tags behind after a
 * client-side navigation. The server HTML is correct, but the hydrated DOM
 * ends up with two canonical links (conflicting SEO signals) and two copies of
 * each icon link.
 *
 * We cannot delete these nodes: Next owns them and later calls removeChild on
 * them, which throws. Instead we retag the stale duplicate so it no longer
 * matches `link[rel="canonical"]` or `link[rel="icon"]`. The node stays in the
 * DOM, so Next's cleanup keeps working.
 *
 * Remove this once Next stops duplicating metadata on client navigation.
 */
const normalizePath = (value: string) => value.replace(/\/+$/, "") || "/";

const canonicalPath = (link: HTMLLinkElement) => {
  try {
    return normalizePath(new URL(link.href).pathname);
  } catch {
    return "";
  }
};

const iconKey = (link: HTMLLinkElement) =>
  [
    link.getAttribute("href"),
    link.getAttribute("type"),
    link.getAttribute("sizes"),
  ].join("|");

export function HeadGuard() {
  const pathname = usePathname();

  useEffect(() => {
    const reconcile = () => {
      const canonicals = Array.from(
        document.querySelectorAll<HTMLLinkElement>('link[rel="canonical"]'),
      );
      if (canonicals.length > 1) {
        const current = normalizePath(window.location.pathname);
        const keep =
          canonicals.find((link) => canonicalPath(link) === current) ??
          canonicals[canonicals.length - 1];
        for (const link of canonicals) {
          if (link !== keep) link.setAttribute("rel", "canonical-stale");
        }
      }

      for (const rel of ["icon", "apple-touch-icon"]) {
        const seen = new Set<string>();
        for (const link of document.head.querySelectorAll<HTMLLinkElement>(
          `link[rel="${rel}"]`,
        )) {
          const key = iconKey(link);
          if (seen.has(key)) {
            link.setAttribute("rel", `${rel}-stale`);
          } else {
            seen.add(key);
          }
        }
      }
    };

    reconcile();
    const observer = new MutationObserver(reconcile);
    observer.observe(document.head, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);

  return null;
}
