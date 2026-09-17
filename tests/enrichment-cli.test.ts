import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../scripts/enrichment";

test("help and release template require no database or paid access", async () => {
  const directory = await mkdtemp(join(tmpdir(), "enrichment-cli-test-"));
  const original = console.log;
  const output: string[] = [];
  console.log = (value: unknown) => {
    output.push(String(value));
  };
  try {
    await main(["--help"]);
    const path = join(directory, "worker.json");
    await writeFile(
      path,
      JSON.stringify({
        configuration: {
          codeDigest: "test-build",
          model: {
            provider: "weft/blockrun",
            model: "fixture",
            revision: "v1",
          },
        },
      }),
    );
    await main(["release-template", "--file", path]);
    assert.ok(output[0].includes("release-template"));
    const manifest = JSON.parse(output[1]);
    assert.equal(manifest.stages.length, 6);
    assert.equal(typeof manifest.recipes.founder_dna, "string");
    assert.deepEqual(manifest.dependencies.founder_dna, ["extraction"]);
  } finally {
    console.log = original;
    await rm(directory, { recursive: true, force: true });
  }
});

test("mutating CLI commands require explicit write confirmation before connecting", async () => {
  await assert.rejects(
    main(["worker"]),
    /explicit_write_confirmation_required/,
  );
  await assert.rejects(
    main(["evaluation-import"]),
    /explicit_write_confirmation_required/,
  );
});

test("worker requires explicit paid flag before reading config or opening database", async () => {
  await assert.rejects(
    main(["worker", "--confirm-write"]),
    /paid_worker_not_enabled/,
  );
});
