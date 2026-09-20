import { expect, test, type Page } from "@playwright/test";

type Captured = { event: string; properties: Record<string, unknown> };
type AnalyticsInit = {
  key: string;
  hasBeforeSend: boolean;
};

async function installAnalyticsStub(page: Page, marked: boolean) {
  await page.addInitScript(
    ({ marked }) => {
      const state = window as typeof window & {
        analyticsEvents: Captured[];
        analyticsInit: AnalyticsInit[];
        analyticsVendorFails: boolean;
        analyticsClipboardFails: boolean;
        posthog: {
          __SV: number;
          __FOUNDER_DIRECTORY_TEST__?: boolean;
          init: (key: string, options: Record<string, unknown>) => void;
          capture: (event: string, properties: Record<string, unknown>) => void;
        };
      };
      type BeforeSend = (event: Captured) => Captured | null;
      state.analyticsEvents = [];
      state.analyticsInit = [];
      state.analyticsVendorFails = false;
      state.analyticsClipboardFails = false;
      let beforeSend: BeforeSend | undefined;
      let token: string | undefined;
      state.posthog = {
        __SV: 1,
        __FOUNDER_DIRECTORY_TEST__: marked || undefined,
        init(key, options) {
          token = key;
          beforeSend = options.before_send as BeforeSend | undefined;
          state.analyticsInit.push({
            key,
            hasBeforeSend: typeof beforeSend === "function",
          });
        },
        capture(event, properties) {
          if (state.analyticsVendorFails) throw new Error("vendor unavailable");
          const candidate = {
            event,
            properties: {
              token,
              distinct_id: "anonymous-test-device",
              $current_url: window.location.href,
              $pathname: window.location.pathname,
              $referrer: "https://search.test/?q=private",
              $initial_referrer: "https://search.test/?q=private",
              $initial_current_url: window.location.href,
              $prev_pageview_pathname: "/u/private_handle",
              $set: { email: "person@example.test" },
              $set_once: { name: "Person" },
              handle: "private_handle",
              copied_text: "private text",
              ...(properties ?? {}),
            },
          };
          const prepared = beforeSend ? beforeSend(candidate) : candidate;
          if (prepared) state.analyticsEvents.push(prepared);
        },
      };
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          async writeText() {
            if (state.analyticsClipboardFails)
              throw new Error("clipboard unavailable");
          },
        },
      });
    },
    { marked },
  );
}

test("Founder DNA interactions emit the strict anonymous contract", async ({
  page,
}) => {
  await installAnalyticsStub(page, true);
  await page.goto("/founder-dna-preview?private=fictional_founder");
  await expect(
    page.getByRole("heading", { name: "Alex Example" }),
  ).toBeVisible();
  await expect
    .poll(() => initCalls(page))
    .toEqual([{ key: "phc_test", hasBeforeSend: true }]);
  await expect.poll(() => eventCount(page, "$pageview")).toBe(1);
  await expect
    .poll(() => eventCount(page, "weft_founder_directory_presence_started"))
    .toBe(1);
  await expect
    .poll(() => eventCount(page, "weft_founder_dna_profile_viewed"))
    .toBe(1);

  await page.locator("#connections").scrollIntoViewIfNeeded();
  await expect
    .poll(() => eventCount(page, "weft_founder_dna_connections_viewed"))
    .toBe(1);

  await page.getByRole("button", { name: /Robin Example/ }).click();
  await preventAndClick(page, "#connection-preview a");

  const cardLink = page.locator("#connections li a").first();
  await cardLink.evaluate((element) =>
    element.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    }),
  );
  await cardLink.click();

  await page
    .getByRole("button", { name: "Copy text and profile link" })
    .click();
  await expect(page.getByRole("status")).toHaveText("Copied. Ready to share.");

  const download = page.getByRole("link", { name: "Download image" });
  await download.evaluate((element) =>
    element.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    }),
  );
  await download.click();

  const captured = await events(page);
  expect(eventCounts(captured)).toEqual({
    $pageview: 1,
    weft_founder_directory_presence_started: 1,
    weft_founder_dna_connection_clicked: 2,
    weft_founder_dna_connection_previewed: 1,
    weft_founder_dna_connections_viewed: 1,
    weft_founder_dna_image_download_started: 1,
    weft_founder_dna_profile_viewed: 1,
    weft_founder_dna_share_copied: 1,
  });

  expect(captured.filter(({ event }) => event === "$pageview")).toEqual([
    {
      event: "$pageview",
      properties: {
        token: "phc_test",
        distinct_id: "anonymous-test-device",
        $current_url: "http://127.0.0.1:3100/founder-dna-preview",
      },
    },
  ]);
  expect(
    captured.filter(
      ({ event }) => event === "weft_founder_directory_presence_started",
    ),
  ).toEqual([
    {
      event: "weft_founder_directory_presence_started",
      properties: {
        schema_version: 1,
        token: "phc_test",
        distinct_id: "anonymous-test-device",
      },
    },
  ]);

  const dna = captured.filter(({ event }) =>
    event.startsWith("weft_founder_dna_"),
  );
  expect(dna).toContainEqual({
    event: "weft_founder_dna_connection_previewed",
    properties: {
      ...profileProperties(),
      connection_id: "55555555-5555-4555-8555-555555555555",
    },
  });
  expect(dna).toContainEqual({
    event: "weft_founder_dna_connection_clicked",
    properties: {
      ...profileProperties(),
      connection_id: "55555555-5555-4555-8555-555555555555",
      destination_profile_id: "66666666-6666-4666-8666-666666666666",
      surface: "graph",
    },
  });
  expect(dna).toContainEqual({
    event: "weft_founder_dna_connection_clicked",
    properties: {
      ...profileProperties(),
      connection_id: "55555555-5555-4555-8555-555555555555",
      destination_profile_id: "66666666-6666-4666-8666-666666666666",
      surface: "card",
    },
  });
  expect(dna).toContainEqual({
    event: "weft_founder_dna_share_copied",
    properties: profileProperties(),
  });
  expect(dna).toContainEqual({
    event: "weft_founder_dna_image_download_started",
    properties: profileProperties(),
  });
  for (const item of dna) {
    expect(Object.keys(item.properties).sort()).toEqual(
      expectedKeys(item.event).sort(),
    );
    expect(JSON.stringify(item)).not.toMatch(
      /fictional_founder|https?:|copied_text|handle|current_url|referrer/,
    );
  }

  await page.evaluate(() => {
    (
      window as typeof window & { analyticsVendorFails: boolean }
    ).analyticsVendorFails = true;
  });
  await page
    .getByRole("button", { name: "Copy text and profile link" })
    .click();
  await expect(page.getByRole("status")).toHaveText("Copied. Ready to share.");

  const copyCount = captured.filter(
    ({ event }) => event === "weft_founder_dna_share_copied",
  ).length;
  await page.evaluate(() => {
    const state = window as typeof window & {
      analyticsVendorFails: boolean;
      analyticsClipboardFails: boolean;
    };
    state.analyticsVendorFails = false;
    state.analyticsClipboardFails = true;
  });
  await page
    .getByRole("button", { name: "Copy text and profile link" })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    "Copy did not work. Select the text and copy it.",
  );
  expect(
    (await events(page)).filter(
      ({ event }) => event === "weft_founder_dna_share_copied",
    ),
  ).toHaveLength(copyCount);
  expect(eventCounts(await events(page))).toEqual(eventCounts(captured));
});

test("preview analytics transport is silent without its explicit marker", async ({
  page,
}) => {
  await installAnalyticsStub(page, false);
  await page.goto("/founder-dna-preview");
  await page
    .getByRole("button", { name: "Copy text and profile link" })
    .click();
  await expect(page.getByRole("status")).toHaveText("Copied. Ready to share.");
  await page.waitForTimeout(50);
  expect(await initCalls(page)).toEqual([]);
  expect(await events(page)).toEqual([]);
});

function profileProperties() {
  return {
    schema_version: 1,
    token: "phc_test",
    distinct_id: "anonymous-test-device",
    profile_id: "11111111-1111-4111-8111-111111111111",
    profile_revision: "profile-revision-1",
    release_id: "22222222-2222-4222-8222-222222222222",
  };
}

function expectedKeys(event: string) {
  const common = [
    "schema_version",
    "token",
    "distinct_id",
    "profile_id",
    "profile_revision",
    "release_id",
  ];
  if (event === "weft_founder_dna_connections_viewed")
    return [...common, "connection_count"];
  if (event === "weft_founder_dna_connection_previewed")
    return [...common, "connection_id"];
  if (event === "weft_founder_dna_connection_clicked")
    return [...common, "connection_id", "destination_profile_id", "surface"];
  return common;
}

async function events(page: Page) {
  return page.evaluate(
    () =>
      (window as typeof window & { analyticsEvents: Captured[] })
        .analyticsEvents,
  ) as Promise<Captured[]>;
}

async function initCalls(page: Page) {
  return page.evaluate(
    () =>
      (window as typeof window & { analyticsInit: AnalyticsInit[] })
        .analyticsInit,
  ) as Promise<AnalyticsInit[]>;
}

async function eventCount(page: Page, event: string) {
  return (await events(page)).filter((item) => item.event === event).length;
}

function eventCounts(captured: Captured[]) {
  return Object.fromEntries(
    [...new Set(captured.map(({ event }) => event))]
      .sort()
      .map((event) => [
        event,
        captured.filter((item) => item.event === event).length,
      ]),
  );
}

async function preventAndClick(page: Page, selector: string) {
  const link = page.locator(selector);
  if (!(await link.count())) return;
  await link.evaluate((element: Element) =>
    element.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    }),
  );
  await link.click();
}
