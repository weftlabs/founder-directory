import { materializePendingIntros } from "../lib/scan";

async function main() {
  const result = await materializePendingIntros();
  console.log(JSON.stringify(result));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
