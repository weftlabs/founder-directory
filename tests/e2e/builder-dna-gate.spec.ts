import { expect, test } from "@playwright/test";

test("Builder DNA is unavailable without its explicit local preview flag", async ({
  request,
}) => {
  const response = await request.get("/lab/builder-dna");
  expect(response.status()).toBe(404);
});
