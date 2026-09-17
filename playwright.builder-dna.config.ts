import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/builder-dna-e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  use: { baseURL: "http://127.0.0.1:3142", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "pnpm start --hostname 127.0.0.1 --port 3142",
    url: "http://127.0.0.1:3142/lab/builder-dna",
    reuseExistingServer: false,
    env: {
      BUILDER_DNA_PREVIEW: "1",
      BUILDER_DNA_SNAPSHOT_FILE: "tests/fixtures/builder-dna.json",
      DATABASE_URL: "",
      WEFT_API_KEY: "",
      CRON_SECRET: "",
      NEXT_PUBLIC_POSTHOG_KEY: "",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
