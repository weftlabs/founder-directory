import Link from "next/link";
import { OnlineNow } from "./online-now";

export const GITHUB_REPO_URL = "https://github.com/weftlabs/founder-directory";

export function SiteHeader({
  directoryCurrent = false,
  aboutCurrent = false,
  mapCurrent = false,
  leaderboardCurrent = false,
}: {
  directoryCurrent?: boolean;
  aboutCurrent?: boolean;
  mapCurrent?: boolean;
  leaderboardCurrent?: boolean;
}) {
  return (
    <header className="top">
      <Link prefetch={false} className="brand" href="/">
        Founder <em>Directory</em>
      </Link>
      <div className="top-nav">
        <Link
          prefetch={false}
          className="directory-link"
          href="/directory"
          aria-current={directoryCurrent ? "page" : undefined}
        >
          Directory
        </Link>
        <Link
          prefetch={false}
          href="/"
          aria-current={mapCurrent ? "page" : undefined}
        >
          Map
        </Link>
        <Link
          prefetch={false}
          href="/leaderboard"
          aria-current={leaderboardCurrent ? "page" : undefined}
        >
          Leaderboard
        </Link>
        <Link
          prefetch={false}
          href="/about"
          aria-current={aboutCurrent ? "page" : undefined}
        >
          About
        </Link>
        <OnlineNow />
        <a
          className="star-link"
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noreferrer"
        >
          ★ Star
        </a>
      </div>
    </header>
  );
}
