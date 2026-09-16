import { readFile } from "node:fs/promises";
import { saveIntroMetrics } from "../lib/db";
import { parseHandle } from "../lib/model";
import type { IntroMetrics } from "../lib/discovery";

const file = process.argv[2];
if (!file || file.startsWith("--"))
  throw new Error(
    "Usage: tsx scripts/import-intro-metrics.ts snapshots.json [--apply]",
  );
const input: unknown = JSON.parse(await readFile(file, "utf8"));
if (!Array.isArray(input))
  throw new Error("Expected an array of source snapshots");
const hits = input.map((row) => {
  if (!row || typeof row !== "object") throw new Error("Invalid snapshot");
  const handle = parseHandle(row.handle);
  if (typeof row.tweetId !== "string" || !/^\d{1,25}$/.test(row.tweetId))
    throw new Error("Invalid source post ID");
  if (
    typeof row.observedAt !== "string" ||
    !Number.isFinite(Date.parse(row.observedAt))
  )
    throw new Error("A capture timestamp is required");
  for (const key of ["likes", "views"]) {
    if (
      row[key] !== null &&
      !(
        typeof row[key] === "number" &&
        Number.isSafeInteger(row[key]) &&
        row[key] >= 0
      )
    )
      throw new Error(`Invalid ${key}`);
  }
  if (row.likes === null && row.views === null)
    throw new Error("No measured counts");
  const introMetrics: IntroMetrics = {
    likes: row.likes,
    views: row.views,
    observedAt: new Date(row.observedAt).toISOString(),
  };
  return { handle, tweetId: row.tweetId, introMetrics };
});
console.log(
  `${hits.length} valid source snapshots. ${process.argv.includes("--apply") ? "Applying to matching introduction URLs." : "Dry run; no database access."}`,
);
if (process.argv.includes("--apply")) await saveIntroMetrics(hits);
