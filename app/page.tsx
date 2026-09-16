import { Directory } from "./directory";
import { lastScanAt, listFounders } from "@/lib/db";
import { relativeTime } from "@/lib/model";

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
      <header className="top">
        <a className="brand" href="/">
          Solo <em>Founders</em>
        </a>
        <div className="fresh">
          Directory · updated <b>{scanned}</b>
        </div>
      </header>
      <Directory founders={founders} scanned={scanned} />
    </>
  );
}
