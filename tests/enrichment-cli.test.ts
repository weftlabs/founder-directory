import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Database, Sql } from "../lib/enrichment/db";
import { main, migrateOperatorDatabase } from "../scripts/enrichment";

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

test("local embedding configuration can be generated without a database", async () => {
  const original = console.log;
  let output = "";
  console.log = (value: unknown) => {
    output = String(value);
  };
  try {
    await main(["local-embedding-config"]);
    const config = JSON.parse(output);
    assert.equal(config.model, "sentence-transformers/all-MiniLM-L6-v2");
    assert.equal(config.dimensions, 384);
    assert.match(config.modelVersion, /script-[a-f0-9]{64}$/);
  } finally {
    console.log = original;
  }
});

test("portrait generation is gated before input reads or database access", async () => {
  await assert.rejects(
    main(["portrait"]),
    /explicit_write_confirmation_required/,
  );
  await assert.rejects(
    main(["portrait", "--confirm-write"]),
    /paid_portrait_not_enabled/,
  );
  await assert.rejects(
    main(["portrait-approve"]),
    /explicit_write_confirmation_required/,
  );
});

test("operator migration supports an empty database and adds legacy intake when founders later exists", async () => {
  const pg = new PGlite();
  const adapt = (client: Pick<PGlite, "query" | "exec">): Sql => ({
    async query<T>(sql: string, values?: unknown[]) {
      if (!values && sql.includes(";")) {
        await client.exec(sql);
        return { rows: [] as T[] };
      }
      return client.query<T>(sql, values);
    },
  });
  const db: Database = {
    ...adapt(pg),
    transaction: (fn) => pg.transaction((tx) => fn(adapt(tx))),
  };
  try {
    assert.equal(await migrateOperatorDatabase(db), false);
    const versions = await db.query<{ version: number }>(
      "SELECT version FROM enrichment_migrations ORDER BY version",
    );
    assert.deepEqual(
      versions.rows.map((r) => r.version),
      [1, 3, 4, 5],
    );
    assert.equal(await migrateOperatorDatabase(db), false);
    await db.query("CREATE TABLE founders(handle text PRIMARY KEY)");
    assert.equal(await migrateOperatorDatabase(db), true);
    assert.equal(await migrateOperatorDatabase(db), true);
    await db.query("INSERT INTO founders(handle) VALUES ('synthetic')");
    assert.equal(
      (
        await db.query(
          "SELECT founder_key FROM enrichment_founder_intake WHERE founder_key='synthetic'",
        )
      ).rows.length,
      1,
    );
  } finally {
    await pg.close();
  }
});
