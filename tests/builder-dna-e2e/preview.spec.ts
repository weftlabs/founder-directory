import { expect, test } from "@playwright/test";

test("Builder DNA filters, selection and evidence work without paid calls", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/lab/builder-dna");
  await expect(page.locator("header.top .brand")).toHaveText(
    "Founder Directory",
  );
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(12, 13, 11)",
  );
  await expect(page.getByTestId("dna-founder-card").first()).toHaveCSS(
    "background-color",
    "rgb(22, 23, 20)",
  );
  await expect(page.getByTestId("dna-founder-card").first()).toHaveCSS(
    "border-radius",
    "16px",
  );
  await expect(page.getByTestId("dna-craft-filter").first()).toHaveCSS(
    "background-color",
    "rgb(216, 255, 62)",
  );
  await expect(page.getByTestId("dna-founder-card")).toHaveCount(2);
  await page
    .getByTestId("dna-craft-filter")
    .filter({ hasText: "Engineering" })
    .click();
  await expect(page.getByTestId("dna-founder-card")).toHaveCount(1);
  await expect(page.getByTestId("dna-founder-card")).toContainText(
    "Example Developer",
  );
  await expect(page.getByTestId("dna-detail")).toHaveCount(0);
  await expect(page.getByTestId("dna-founder-card")).toHaveAttribute(
    "href",
    "/u/example_dev",
  );
  await page.getByTestId("dna-founder-card").click();
  await expect(page).toHaveURL(/\/u\/example_dev$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Example Developer",
  );
  await expect(page).toHaveTitle(/Example Developer.*Example Health/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://foundersdirectory.app/u/example_dev",
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /synthetic healthcare example/,
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, nofollow",
  );
  await page.reload();
  await expect(page.getByTestId("dna-detail")).toContainText("Example Health");
  await expect(page.getByTestId("dna-detail")).toContainText("Healthcare");
  await page.getByTestId("dna-evidence-toggle").first().click();
  await expect(page.getByTestId("dna-detail")).toContainText(
    "Synthetic developer source",
  );
  await expect(
    page.getByTestId("dna-detail").locator("blockquote"),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open original source" }),
  ).toHaveAttribute("href", "https://example.com/health");
  await page.getByRole("link", { name: "← Directory", exact: true }).click();
  await expect(page).toHaveURL(/\/lab\/builder-dna$/);
  await page.getByTestId("dna-search").fill("no such founder 999");
  await expect(page.getByTestId("dna-founder-card")).toHaveCount(0);
  await expect(page.getByTestId("dna-empty")).toBeVisible();
  await page.getByTestId("dna-search").fill("");
  await expect(page.getByTestId("dna-founder-card")).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
