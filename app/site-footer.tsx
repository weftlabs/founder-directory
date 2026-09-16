import { NITTARAB_X, WEFTLABS_URL } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="site">
      <a href="/about">About</a>
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
