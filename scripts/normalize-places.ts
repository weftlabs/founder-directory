import { neon } from "@neondatabase/serverless";
import { emptyPlace, normalizePlaces } from "../lib/place";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("no db");
  const sql = neon(url);
  const rows = (await sql`
    SELECT handle, location FROM founders
  `) as { handle: string; location: string | null }[];
  const raws = [
    ...new Set(
      rows
        .map((row) => row.location?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  // Keep model output below the upstream delivery timeout. Resolve every batch
  // before writing, so an outage cannot wipe existing chips.
  const places = new Map<string, import("../lib/place").Place>();
  for (let i = 0; i < raws.length; i += 40) {
    const batch = await normalizePlaces(raws.slice(i, i + 40), {
      strict: true,
    });
    for (const [raw, place] of batch) places.set(raw, place);
    console.log(
      JSON.stringify({ normalized: places.size, total: raws.length }),
    );
  }
  let updated = 0;
  for (const row of rows) {
    const place = row.location
      ? (places.get(row.location.trim()) ?? emptyPlace())
      : emptyPlace();
    const changed = await sql`
      UPDATE founders
      SET city = ${place.city}, country = ${place.country}
      WHERE handle = ${row.handle} AND location IS NOT DISTINCT FROM ${row.location}
      RETURNING handle
    `;
    updated += changed.length;
  }
  console.log(JSON.stringify({ updated, mapped: places.size }));
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
