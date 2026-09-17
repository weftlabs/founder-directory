import type { Metadata } from "next";
import { Directory } from "../directory";
import { SiteHeader } from "../site-header";
import { lastScanAt, listDirectoryPage } from "@/lib/db";
import { emptyFilters } from "@/lib/directory-filters";
import { emptyDirectoryPage } from "@/lib/directory-page";
import { relativeTime } from "@/lib/model";

export const metadata: Metadata = {
  alternates: { canonical: "/directory" },
};

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined) {
  return typeof value === "string"
    ? value
    : Array.isArray(value)
      ? (value[0] ?? "")
      : "";
}

export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = {
    ...emptyFilters,
    q: first(params.q),
    category: first(params.category),
    country: first(params.country),
    city: first(params.city),
  };
  let page = emptyDirectoryPage();
  let scanned = "not yet";
  try {
    page = await listDirectoryPage({
      ...filters,
      cursor: first(params.cursor),
    });
    scanned = relativeTime(await lastScanAt());
  } catch {
    page = emptyDirectoryPage();
  }
  const initialSearch = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => value),
  ).toString();
  return (
    <>
      <SiteHeader directoryCurrent />
      <Directory
        key={JSON.stringify(params)}
        initialPage={page}
        initialSearch={initialSearch ? `?${initialSearch}` : ""}
        scanned={scanned}
      />
    </>
  );
}
