import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-sans/latin-700.css";
import { Analytics } from "./analytics";
import { SiteFooter } from "./site-footer";
import {
  GITHUB_REPO,
  NITTARAB_X,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  WEFTLABS_URL,
  WEFTLABS_X,
} from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [
    { name: "Nittarab", url: NITTARAB_X },
    { name: "Weft Labs", url: WEFTLABS_URL },
  ],
  creator: "Nittarab",
  publisher: "Weft Labs",
  keywords: [
    "solo founder",
    "founders directory",
    "I'm a solo founder",
    "X",
    "Twitter",
  ],
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    creator: "@nittarab",
    site: "@weftlabs",
  },
  robots: {
    index: true,
    follow: true,
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      name: SITE_NAME,
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      sameAs: [GITHUB_REPO],
      publisher: { "@id": `${SITE_URL}/#org` },
      creator: { "@id": `${SITE_URL}/#person` },
    },
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#org`,
      name: "Weft Labs",
      url: WEFTLABS_URL,
      sameAs: [WEFTLABS_X, "https://github.com/weftlabs"],
    },
    {
      "@type": "Person",
      "@id": `${SITE_URL}/#person`,
      name: "Patrick Barattin",
      alternateName: "Nittarab",
      url: NITTARAB_X,
      sameAs: [NITTARAB_X],
      worksFor: { "@id": `${SITE_URL}/#org` },
    },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-directory-preview={
        process.env.DIRECTORY_PREVIEW === "1" ? "1" : undefined
      }
    >
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <Analytics preview={process.env.DIRECTORY_PREVIEW === "1"} />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
