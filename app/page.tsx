import type { Metadata } from "next";
import { Directory } from "./directory";
import { SiteHeader } from "./site-header";
import { lastScanAt, listFounders } from "@/lib/db";
import { relativeTime } from "@/lib/model";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export const dynamic = "force-dynamic";

export default async function Home() {
  let founders: Awaited<ReturnType<typeof listFounders>> = [];
  let scanned = "not yet";
  try {
    founders = await listFounders();
    scanned = relativeTime(await lastScanAt());
  } catch {
    founders = [];
  }
  return (
    <>
      <SiteHeader />
      <Directory founders={founders} scanned={scanned} />
    </>
  );
}
