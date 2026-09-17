import { expect, test } from "@playwright/test";

test("photo pins select founders, fall back to initials, and group only the current page", async ({
  page,
}) => {
  await page.route("https://i.pravatar.cc/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="teal"/></svg>',
    }),
  );
  await page.goto("/discovery-preview");
  await expect(page.locator(".map-avatar-pin")).toHaveCount(8);
  const alex = page.getByRole("button", {
    name: "Meet Alex Example in Berlin",
    exact: true,
  });
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await expect(alex).toBeHidden();
  // Filtering to an isolated point shows its portrait without selecting it.
  await page.getByRole("searchbox").fill("Berlin");
  await expect(alex.locator("img")).toBeVisible();
  await expect
    .poll(() =>
      alex
        .locator("img")
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await alex.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".map-profile")).toContainText("Alex Example");
  await expect(alex).toHaveAttribute("data-selected", "true");
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await page.getByRole("button", { name: "World view" }).click();
  await expect(alex).toBeHidden();
  // Zooming to a founder expands the cluster back into photo pins.
  await page.getByRole("button", { name: "Show Alex Example on map" }).click();
  await expect(alex).toBeVisible();
  await page.getByRole("searchbox").fill("Paris");
  await expect(page.locator(".map-avatar-pin")).toHaveCount(1);
  await expect(page.locator(".map-avatar-pin")).toContainText("ME");
  await page.route("https://i.pravatar.cc/**", (route) => route.abort());
  await page.goto("/discovery-preview?bounded=1");
  await expect(page.locator(".map-avatar-pin")).toHaveCount(1);
  await expect(page.locator(".map-avatar-pin img")).toHaveCount(0);
  await expect(page.locator(".map-avatar-initials")).toHaveText("BF");
  await expect(page.locator(".map-avatar-count")).toHaveText("48");
  await page
    .getByRole("button", { name: "Explore 48 founders on this page in Berlin" })
    .click();
  await expect(page.locator(".map-group")).toContainText("48 founders");
  await expect(page.locator(".map-group")).not.toContainText(
    "Bounded Founder 48",
  );
});

test("map search, selection, category and country filters agree", async ({
  page,
}) => {
  await page.goto("/discovery-preview");
  await expect(
    page.getByRole("heading", { name: "Big ideas. Everywhere." }),
  ).toBeVisible();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  expect(
    (await page.locator(".maplibregl-canvas").boundingBox())!.height,
  ).toBeGreaterThan(300);
  await expect(page.locator(".coverage-note")).toContainText(
    "8 mapped · 2 without",
  );
  await page.getByRole("button", { name: "Show Alex Example on map" }).click();
  await expect(page.locator(".map-profile")).toContainText("Alex Example");
  await expect(page.locator(".map-profile a")).toHaveAttribute(
    "href",
    "/u/example_0",
  );
  await page
    .getByRole("combobox", { name: "Country", exact: true })
    .selectOption("Germany");
  await expect(page.locator(".discovery-rows li")).toHaveCount(1);
  await expect(page.locator(".coverage-note")).toContainText(
    "1 mapped · 0 without",
  );
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No founders match these filters." }),
  ).toBeVisible();
  await expect(page.locator(".map-profile")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await page.getByRole("searchbox").fill("Mars");
  await expect(page.locator(".coverage-note")).toContainText(
    "0 mapped · 1 without",
  );
  await expect(page.locator(".discovery-rows li")).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("map stays public without leaderboard code", async ({ page, request }) => {
  await page.goto("/map");
  await expect(page.locator("header a[href='/map']")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.locator("a[href='/leaderboard']")).toHaveCount(0);
  await expect(page.locator(".podium-card")).toHaveCount(0);
  expect((await request.get("/leaderboard")).status()).toBe(404);
  expect((await request.get("/_drafts/leaderboard")).status()).toBe(404);
  expect(await (await request.get("/sitemap.xml")).text()).not.toContain(
    "/leaderboard",
  );
});

test("map network failure keeps the founder list usable", async ({ page }) => {
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.abort(),
  );
  await page.goto("/discovery-preview");
  await expect(page.locator(".map-failure")).toBeVisible({ timeout: 20000 });
  await page.getByRole("searchbox").fill("Berlin");
  await expect(page.locator(".discovery-rows li")).toHaveCount(1);
});

test("bounded pages do not embed the hidden index and require page navigation", async ({
  page,
  request,
}) => {
  {
    const response = await request.get("/discovery-preview?bounded=1");
    const html = await response.text();
    expect(html).toContain("bounded_47");
    expect(html).not.toContain("bounded_48");
    expect(html).not.toContain("bounded_119");
    await page.goto("/discovery-preview?bounded=1");
    await expect(page.locator(".discovery-rows li")).toHaveCount(48);
    await page.getByRole("link", { name: "Next page" }).click();
    await expect(page.locator(".discovery-rows li").first()).toContainText(
      "Bounded Founder 48",
    );
    await expect(page.locator(".discovery-rows li")).toHaveCount(48);
    await page.getByRole("searchbox").fill("Visible bio 119");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.locator(".discovery-rows li")).toHaveCount(1);
    await expect(page.locator(".discovery-rows li")).toContainText(
      "Bounded Founder 119",
    );
  }
});
