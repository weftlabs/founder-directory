import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("no db");
  const sql = neon(url);
  const rows = (await sql`
    SELECT handle, location, city, country FROM founders
    ORDER BY location
  `) as { handle: string; location: string | null; city: string | null; country: string | null }[];
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
