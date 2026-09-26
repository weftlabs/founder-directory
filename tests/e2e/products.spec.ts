import { expect, test } from "@playwright/test";

test("Products navigation and the public empty state work without enrichment", async ({
  page,
}) => {
  await page.goto("/products");
  await expect(page).toHaveTitle("Products | Founder Directory");
  await expect(
    page.getByRole("link", { name: "Products", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("product-count")).toHaveText("0 products");
  await expect(
    page.getByRole("heading", { name: "The next discovery starts here." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Meet the founders" }).click();
  await expect(page).toHaveURL(/\/directory$/);
  await page.getByRole("link", { name: "Products", exact: true }).click();
  await expect(page).toHaveURL(/\/products$/);
});

test("synthetic Products have bounded pages, safe links, combined filters and history", async ({
  page,
}) => {
  await page.goto("/products-preview");
  await expect(
    page.getByText("Design preview · fictional sample products"),
  ).toBeVisible();
  await expect(page.getByTestId("product-card")).toHaveCount(12);
  await expect(page.getByTestId("product-count")).toHaveText("27 products");
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(
    page
      .getByTestId("product-card")
      .first()
      .getByText("Unknown", { exact: true }),
  ).toHaveCount(2);
  await page.getByRole("link", { name: "Next →" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(
    page.getByRole("heading", { name: "Example 13", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Product categories" })
    .getByRole("link", { name: /^Health/ })
    .click();
  await expect(page).toHaveURL(/category=health$/);
  await expect(page.getByTestId("product-count")).toHaveText("14 products");
  await page
    .getByRole("searchbox", { name: "Search products" })
    .fill("Doctors");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/q=Doctors&category=health/);
  await expect(page.getByTestId("product-count")).toHaveText(
    "14 products for “Doctors”",
  );
  await page.getByRole("link", { name: "Next →" }).click();
  await expect(page).toHaveURL(/q=Doctors&category=health&page=2/);
  await expect(page.getByTestId("product-card")).toHaveCount(2);
  await page
    .getByRole("searchbox", { name: "Search products" })
    .fill("nothing-matches");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(
    page.getByRole("heading", { name: "No products match these filters." }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/page=/);
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(
    page.getByRole("searchbox", { name: "Search products" }),
  ).toHaveValue("");
  await expect(page.getByTestId("product-count")).toHaveText("27 products");
  await page.goBack();
  await expect(
    page.getByRole("searchbox", { name: "Search products" }),
  ).toHaveValue("nothing-matches");
  const dimensions = await page.evaluate(() => ({
    width: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
});

test("product images load and failed images have a stable fallback", async ({
  page,
}) => {
  await page.route("https://example.test/product.png", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9xkAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await page.goto("/products-preview");
  const image = page.getByRole("img", {
    name: "Example 01 image",
    exact: true,
  });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await expect(
    page
      .getByTestId("product-card")
      .first()
      .getByRole("link", { name: /example_1/ }),
  ).toHaveCount(0);
  await page.unroute("https://example.test/product.png");
  await page.route("https://example.test/product.png", (route) =>
    route.abort(),
  );
  await page.route("https://example.com/favicon.ico", (route) => route.abort());
  // Let image requests fail before client scripts attach their event handlers.
  await page.route("**/_next/static/chunks/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.reload();
  await expect(
    page.getByLabel("Example 01: image unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Example 02: image unavailable", { exact: true }),
  ).toBeVisible();
});
