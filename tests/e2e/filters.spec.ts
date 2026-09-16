import { test, expect } from "@playwright/test";

test("location filters preserve URL state and connect country and city", async ({
  page,
  isMobile,
}) => {
  await page.goto("/filter-preview?ref=test");
  await expect(page.locator(".card")).toHaveCount(9);
  const controls = isMobile
    ? page.getByRole("dialog")
    : page.locator(".desktop-filters");
  const open = async () => {
    if (isMobile)
      await page.getByRole("button", { name: /^Filters \(/ }).click();
  };
  const close = async () => {
    if (isMobile)
      await controls.getByRole("button", { name: /^Show / }).click();
  };
  await open();
  await controls.locator("summary").filter({ hasText: "Country" }).click();
  await controls
    .getByRole("searchbox", { name: "Search country options" })
    .fill("ger");
  await controls
    .getByRole("button", { name: "Germany 3", exact: true })
    .click();
  await controls.locator("summary").filter({ hasText: "City" }).click();
  await expect(
    controls.getByRole("button", { name: "Paris, France 1", exact: true }),
  ).toHaveCount(0);
  await controls
    .getByRole("button", { name: "Berlin, Germany 2", exact: true })
    .click();
  await close();
  await expect(page.locator(".card")).toHaveCount(2);
  await expect(page).toHaveURL(/ref=test.*country=Germany.*city=Berlin/);
  await page.reload();
  await expect(page.locator(".card")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Remove country filter: Germany" })
    .click();
  await expect(page.locator(".card")).toHaveCount(9);
  await page.goBack();
  await expect(page.locator(".card")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await open();
  await controls.locator("summary").filter({ hasText: "City" }).click();
  await controls
    .getByRole("searchbox", { name: "Search city options" })
    .fill("paris");
  await expect(
    controls.getByRole("button", {
      name: "Paris, United States 1",
      exact: true,
    }),
  ).toBeVisible();
  await controls
    .getByRole("button", { name: "Paris, France 1", exact: true })
    .click();
  await close();
  await expect(page.locator(".card")).toHaveCount(1);
  await expect(page).toHaveURL(/country=France.*city=Paris/);
  if (isMobile) {
    await open();
    await page.keyboard.press("Escape");
    await expect(controls).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Filters \(/ }),
    ).toBeFocused();
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
