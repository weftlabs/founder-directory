import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

const checker = resolve("scripts/check-repo.mjs");
function check(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "founder-repo-test-"));
  try {
    execFileSync("git", ["init", "--quiet", dir]);
    const fixture = {
      "vercel.json": JSON.stringify({
        git: { deploymentEnabled: { main: false } },
      }),
      ...files,
    };
    for (const [file, text] of Object.entries(fixture)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), text);
    }
    return spawnSync(process.execPath, [checker], {
      cwd: dir,
      encoding: "utf8",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("repository check accepts local docs and pure client imports", () => {
  const result = check({
    "README.md": "[Guide](docs/guide.md)",
    "docs/guide.md": "Public guide",
    "app/view.tsx":
      '"use client"; import type { Founder } from "../lib/model";',
    "lib/model.ts": "export type Founder = { name: string };",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("repository check rejects stale branding and broken local links", () => {
  const result = check({
    "README.md": "Solo " + "Founders [missing](docs/missing.md)",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /stale product branding/);
  assert.match(result.stderr, /broken local link/);
});

test("repository check follows transitive client imports to server SDKs", () => {
  const result = check({
    "app/view.tsx": '"use client"; import { helper } from "../lib/helper";',
    "lib/helper.ts": 'export { client as helper } from "./provider";',
    "lib/provider.ts":
      'import { WeftClient } from "@weft-labs/sdk"; export const client = WeftClient;',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /server dependency @weft-labs\/sdk/);
});

test("repository check rejects committed environment files", () => {
  const result = check({ ".env.production": "EXAMPLE=not-a-secret" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /environment file must not be committed/);
});

test("repository check rejects Vercel Git production deploys from main", () => {
  const result = check({
    "vercel.json": JSON.stringify({ git: { deploymentEnabled: true } }),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /rules must be exactly/);
});

test("repository check rejects an overlapping rule that re-enables main", () => {
  const result = check({
    "vercel.json": JSON.stringify({
      git: { deploymentEnabled: { main: false, "*": true } },
    }),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /rules must be exactly/);
});
