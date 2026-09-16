import type { ReactNode } from "react";

export function SiteHeader({
  aside,
  aboutCurrent = false,
}: {
  aside?: ReactNode;
  aboutCurrent?: boolean;
}) {
  return (
    <header className="top">
      <a className="brand" href="/">
        Solo <em>Founders</em>
      </a>
      <div className="top-nav">
        <a href="/about" aria-current={aboutCurrent ? "page" : undefined}>
          About
        </a>
        {aside}
      </div>
    </header>
  );
}
