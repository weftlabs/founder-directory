// Unit tests are not authorized to use local production credentials or HTTP.
for (const key of [
  "WEFT_API_KEY",
  "DATABASE_URL",
  "CRON_SECRET",
  "ENRICHMENT_DATABASE_URL",
  "ENRICHMENT_ALLOW_PAID",
  "ENRICHMENT_CAPTURE_CONFIG",
])
  delete process.env[key];
globalThis.fetch = async () => {
  throw new Error("Network disabled in unit tests; stub the provider boundary");
};
