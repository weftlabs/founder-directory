import { runScan, scanLimits } from "../lib/scan";

async function main() {
  const result = await runScan(scanLimits(true));
  console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
