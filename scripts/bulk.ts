import { BULK_SCAN_PAGES, runScan } from "../lib/scan";

async function main() {
  const result = await runScan({ maxPages: BULK_SCAN_PAGES });
  console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
