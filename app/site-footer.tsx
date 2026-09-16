import Link from "next/link";
import { GITHUB_REPO, NITTARAB_X, WEFTLABS_URL } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="site">
      <nav aria-label="About and source">
        <Link href="/about">About</Link>
        <a href={GITHUB_REPO} rel="noopener noreferrer">
          GitHub
        </a>
      </nav>
      <p>
        Built by{" "}
        <a href={NITTARAB_X} rel="noopener noreferrer me">
          Nittarab
        </a>{" "}
        ·{" "}
        <a href={WEFTLABS_URL} rel="noopener noreferrer">
          Weft Labs
        </a>
      </p>
    </footer>
  );
}
