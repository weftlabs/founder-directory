import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// Fresh processes avoid module-cache effects; imports alone must never call an API.
for (const name of ["weft", "db"]) {
  test(`${name} refuses browser execution before reading credentials`, () => {
    const target = new URL(`../lib/${name}.ts`, import.meta.url).href;
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        `
      globalThis.window = {};
      globalThis.fetch = () => { throw new Error("Network forbidden"); };
      try {
        await import(${JSON.stringify(target)});
        process.exitCode = 1;
      } catch (error) {
        if (error.message !== "This module is server-only") throw error;
      }
    `,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, WEFT_API_KEY: "", DATABASE_URL: "" },
      },
    );
    assert.equal(result.status, 0, result.stderr);
  });
}
