// Unit tests are not authorized to use local production credentials or HTTP.
for (const key of [
  "WEFT_API_KEY",
  "TYPESAFE_AI_API_KEY",
  "TYPESAGE_AI_API_KEY",
  "TYPESAFE_API_KEY",
  "DATABASE_URL",
  "CRON_SECRET",
  "ENRICHMENT_DATABASE_URL",
  "ENRICHMENT_ALLOW_PAID",
  "ENRICHMENT_CAPTURE_CONFIG",
  "NEXT_PUBLIC_POSTHOG_KEY",
  "NEXT_PUBLIC_POSTHOG_HOST",
  "NEXT_PUBLIC_RELEASE_SHA",
  "VERCEL",
  "VERCEL_DEPLOYMENT_ID",
  "VERCEL_PROJECT_PRODUCTION_URL",
])
  delete process.env[key];
globalThis.fetch = async () => {
  throw new Error("Network disabled in unit tests; stub the provider boundary");
};
