import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("metric replay command validates offline and rejects malformed counts", () => {
  const dir = mkdtempSync(join(tmpdir(), "metric-replay-"));
  const file = join(dir, "snapshots.json");
  const row = {
    handle: "example",
    tweetId: "123",
    likes: 12,
    views: null,
    observedAt: "2026-09-17T00:00:00Z",
  };
  const run = () =>
    spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--import",
        "./tests/no-network.mjs",
        "scripts/import-intro-metrics.ts",
        file,
      ],
      { encoding: "utf8", env: { ...process.env, DATABASE_URL: "" } },
    );
  try {
    writeFileSync(file, JSON.stringify([row]));
    const valid = run();
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(
      valid.stdout,
      /1 valid source snapshots.*Dry run; no database access/,
    );
    writeFileSync(file, JSON.stringify([{ ...row, likes: -1 }]));
    const invalid = run();
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /Metric import failed/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
