import { expect, test } from "@playwright/test";

test("founder pages serve unique metadata and evidence without client rendering", async ({
  request,
}) => {
  for (const [handle, name] of [
    ["example_dev", "Example Developer"],
    ["example_ops", "Example Operator"],
  ]) {
    const response = await request.get(`/u/${handle}`);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain(`https://foundersdirectory.app/u/${handle}`);
    expect(html).toMatch(new RegExp(`<h1[^>]*>${name}</h1>`));
    const scripts = [
      ...html.matchAll(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
      ),
    ].map((match) => JSON.parse(match[1]));
    const schema = scripts.find((item) => item["@type"] === "ProfilePage");
    expect(schema.mainEntity.name).toBe(name);
    expect(schema.mainEntity["@type"]).toBe("Person");
    expect(html).toContain("Supporting evidence");
  }
  expect((await request.get("/u/missing_example")).status()).toBe(404);
});
