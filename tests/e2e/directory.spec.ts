import { expect, test } from "@playwright/test";

test("directory works without credentials on desktop and mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("Founder Directory");
  await expect(
    page.getByRole("link", { name: "Founder Directory" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Find the people building.",
  );
  await expect(
    page.locator("footer").getByRole("link", { name: "GitHub" }),
  ).toHaveAttribute("href", "https://github.com/weftlabs/founder-directory");
  await expect(page.locator("header")).not.toContainText("updated");
  await expect(page.locator("p.lede")).not.toContainText("Updated");
  await expect(page.locator(".count .updated")).toContainText("Updated");
  const search = page.getByRole("searchbox", { name: "Search founders" });
  await search.focus();
  expect(await search.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe(
    "none",
  );
  await search.fill("synthetic no-match query");
  await expect(page.getByText("No one matches that filter.")).toBeVisible();
  for (const chip of await page
    .getByRole("button", { name: "All", exact: true })
    .all()) {
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("founders API is public and empty without a database", async ({
  request,
}) => {
  const empty = {
    founders: [],
    total: 0,
    nextCursor: null,
    categories: [],
    countries: [],
    cities: [],
  };
  const get = await request.get("/api/founders");
  expect(get.status()).toBe(200);
  expect(await get.json()).toEqual(empty);
  const filtered = await request.get(
    "/api/founders?q=alice&cursor=not-a-cursor",
  );
  expect(filtered.status()).toBe(200);
  expect(await filtered.json()).toEqual(empty);
});

test("presence is public and the header shows an online count without a database", async ({
  page,
  request,
}) => {
  const get = await request.get("/api/presence");
  expect(get.status()).toBe(200);
  expect(await get.json()).toEqual({ online: 0 });
  const post = await request.post("/api/presence", {
    data: { sessionId: "not-a-uuid" },
  });
  expect(post.status()).toBe(200);
  expect(await post.json()).toEqual({ online: 0 });
  await page.goto("/");
  await expect(page.locator("p.online")).toBeVisible();
  await expect(page.locator("p.online b")).toHaveText("0");
  await expect(
    page.locator("header").getByRole("link", { name: "★ Star" }),
  ).toHaveAttribute("href", "https://github.com/weftlabs/founder-directory");
  await expect(page.locator("header a.directory-link")).toHaveAttribute(
    "href",
    "/",
  );
});

test("cron rejects unauthenticated requests, including bulk", async ({
  request,
}) => {
  for (const path of [
    "/api/cron/scan",
    "/api/cron/scan?bulk=1",
    "/api/cron/discover",
    "/api/cron/hydrate",
  ]) {
    const response = await request.get(path);
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  }
});

test("About navigation, attribution, and SEO survive the branding change", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page
    .locator("header")
    .getByRole("link", { name: "About", exact: true })
    .click();
  await expect(page).toHaveTitle("About | Founder Directory");
  await expect(
    page.locator('link[rel="icon"][type="image/x-icon"]'),
  ).toHaveAttribute("href", /\/favicon\.ico/);
  await expect(
    page.locator('link[rel="icon"][type="image/svg+xml"]'),
  ).toHaveAttribute("href", /\/icon\.svg/);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    /\/apple-icon\.png/,
  );
  await expect(
    page.locator("header").getByRole("link", { name: "About", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", {
      name: "Find the founders taking part in the trend.",
    }),
  ).toBeVisible();
  await expect(
    page.locator("footer").getByRole("link", { name: "GitHub" }),
  ).toHaveAttribute("href", "https://github.com/weftlabs/founder-directory");
  await expect(
    page.getByRole("heading", { name: "How it's built" }),
  ).toBeVisible();
  await expect(
    page
      .locator("main.about")
      .getByRole("link", { name: "weftlabs/founder-directory" }),
  ).toHaveAttribute("href", "https://github.com/weftlabs/founder-directory");
  await expect(
    page.locator("footer").getByRole("link", { name: "Weft Labs" }),
  ).toHaveAttribute("href", "https://weftlabs.com");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://foundersdirectory.app/about",
  );
  const schema = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents();
  expect(schema.some((text) => JSON.parse(text)["@type"] === "AboutPage")).toBe(
    true,
  );
  expect(
    schema.some((text) => {
      const data = JSON.parse(text);
      const nodes = Array.isArray(data["@graph"]) ? data["@graph"] : [data];
      return nodes.some(
        (node: { "@type"?: string; sameAs?: string[] }) =>
          node["@type"] === "WebSite" &&
          node.sameAs?.includes(
            "https://github.com/weftlabs/founder-directory",
          ),
      );
    }),
  ).toBe(true);
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  expect(await sitemap.text()).toContain("https://foundersdirectory.app/about");
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain("sitemap.xml");
  const image = await request.get("/opengraph-image");
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toContain("image/png");
  const favicon = await request.get("/favicon.ico");
  expect(favicon.status()).toBe(200);
  expect(favicon.headers()["content-type"]).toContain("image/x-icon");
  const icon = await request.get("/icon.svg");
  expect(icon.status()).toBe(200);
  expect(icon.headers()["content-type"]).toContain("image/svg+xml");
  const appleIcon = await request.get("/apple-icon.png");
  expect(appleIcon.status()).toBe(200);
  expect(appleIcon.headers()["content-type"]).toContain("image/png");
});

test("unknown profiles return 404 rather than inventing a founder", async ({
  request,
}) => {
  const response = await request.get("/u/fixture_missing");
  expect(response.status()).toBe(404);
});

test("ordinary founder profiles advertise and serve their social card", async ({
  page,
  request,
}) => {
  const response = await page.goto("/u/fixture_founder");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/示例 Founder/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    /\/u\/fixture_founder\/share-image$/,
  );
  const image = await request.get("/u/fixture_founder/share-image");
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toContain("image/png");
});
