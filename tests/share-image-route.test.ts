import assert from "node:assert/strict";
import { test } from "node:test";

test("social card renders international input without network font fallback", async () => {
  const previous = process.env.DIRECTORY_PREVIEW;
  const previousBuilderPreview = process.env.BUILDER_DNA_PREVIEW;
  const previousSnapshot = process.env.BUILDER_DNA_SNAPSHOT_FILE;
  process.env.DIRECTORY_PREVIEW = "1";
  try {
    const { GET } = await import("../app/u/[handle]/share-image/route");
    for (const handle of ["fixture_founder", "example_ops"]) {
      if (handle === "example_ops") {
        process.env.BUILDER_DNA_PREVIEW = "1";
        process.env.BUILDER_DNA_SNAPSHOT_FILE =
          "tests/fixtures/builder-dna.json";
      }
      const response = await GET(new Request("http://localhost"), {
        params: Promise.resolve({ handle }),
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/png");
      assert.ok((await response.arrayBuffer()).byteLength > 1_000);
    }
  } finally {
    if (previous === undefined) delete process.env.DIRECTORY_PREVIEW;
    else process.env.DIRECTORY_PREVIEW = previous;
    if (previousBuilderPreview === undefined)
      delete process.env.BUILDER_DNA_PREVIEW;
    else process.env.BUILDER_DNA_PREVIEW = previousBuilderPreview;
    if (previousSnapshot === undefined)
      delete process.env.BUILDER_DNA_SNAPSHOT_FILE;
    else process.env.BUILDER_DNA_SNAPSHOT_FILE = previousSnapshot;
  }
});
