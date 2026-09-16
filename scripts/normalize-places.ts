import { neon } from "@neondatabase/serverless";
import { emptyPlace, normalizePlaces } from "../lib/place";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("no db");
  const sql = neon(url);
  const rows = (await sql`
    SELECT handle, location FROM founders
  `) as { handle: string; location: string | null }[];
  const places = await normalizePlaces(
    rows
      .map((row) => row.location)
      .filter((value): value is string => Boolean(value)),
  );
  let updated = 0;
  for (const row of rows) {
    const place = row.location
      ? (places.get(row.location) ?? emptyPlace())
      : emptyPlace();
    await sql`
      UPDATE founders
      SET city = ${place.city}, country = ${place.country}
      WHERE handle = ${row.handle}
    `;
    updated += 1;
  }
  console.log(JSON.stringify({ updated, mapped: places.size }));
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
