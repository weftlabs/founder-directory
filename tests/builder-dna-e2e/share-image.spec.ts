import { expect, test } from "@playwright/test";

test("each founder advertises a distinct large social card and serves a real PNG", async ({
  page,
  request,
}) => {
  const images: Buffer[] = [];
  for (const handle of ["example_dev", "example_ops"]) {
    await page.goto(`/u/${handle}`);
    const url = `https://foundersdirectory.app/u/${handle}/share-image`;
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      url,
    );
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute(
      "content",
      url,
    );
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      "content",
      "summary_large_image",
    );
    const response = await request.get(`/u/${handle}/share-image`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");
    const image = await response.body();
    expect(image.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(image.readUInt32BE(16)).toBe(1200);
    expect(image.readUInt32BE(20)).toBe(630);
    images.push(image);
  }
  expect(images[0].equals(images[1])).toBe(false);
  expect((await request.get("/u/missing_example/share-image")).status()).toBe(
    404,
  );
});
