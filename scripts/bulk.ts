import { runScan } from "../lib/scan";

async function main() {
  const result = await runScan({ maxPages: 20 });
  console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
