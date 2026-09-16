import Link from "next/link";
import type { ReactNode } from "react";
import { OnlineNow } from "./online-now";

export function SiteHeader({
  aside,
  aboutCurrent = false,
}: {
  aside?: ReactNode;
  aboutCurrent?: boolean;
}) {
  return (
    <header className="top">
      <Link className="brand" href="/">
        Founder <em>Directory</em>
      </Link>
      <div className="top-nav">
        <Link href="/about" aria-current={aboutCurrent ? "page" : undefined}>
          About
        </Link>
        {aside}
        <OnlineNow />
      </div>
    </header>
  );
}
