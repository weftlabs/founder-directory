import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "../app/api/release/route";
import { releaseProvenance } from "../lib/release-provenance";

test("release provenance accepts only a full SHA and Vercel deployment ID", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const deploymentId = "dpl_Abc123";
  assert.deepEqual(releaseProvenance(sha, deploymentId), {
    sha,
    deployment_id: deploymentId,
  });
  for (const [invalidSha, invalidDeploymentId] of [
    [undefined, deploymentId],
    ["", deploymentId],
    ["0123456", deploymentId],
    [sha.toUpperCase(), deploymentId],
    [`${sha}0`, deploymentId],
    [sha, undefined],
    [sha, "deployment_123"],
  ])
    assert.equal(releaseProvenance(invalidSha, invalidDeploymentId), null);
});

test("release route returns bounded no-store provenance", async () => {
  const original = process.env.NEXT_PUBLIC_RELEASE_SHA;
  const originalDeploymentId = process.env.VERCEL_DEPLOYMENT_ID;
  try {
    process.env.NEXT_PUBLIC_RELEASE_SHA =
      "0123456789abcdef0123456789abcdef01234567";
    process.env.VERCEL_DEPLOYMENT_ID = "dpl_Abc123";
    const response = GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      sha: "0123456789abcdef0123456789abcdef01234567",
      deployment_id: "dpl_Abc123",
    });
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_RELEASE_SHA;
    else process.env.NEXT_PUBLIC_RELEASE_SHA = original;
    if (originalDeploymentId === undefined)
      delete process.env.VERCEL_DEPLOYMENT_ID;
    else process.env.VERCEL_DEPLOYMENT_ID = originalDeploymentId;
  }
});

test("release route fails closed when build provenance is unavailable", async () => {
  const original = process.env.NEXT_PUBLIC_RELEASE_SHA;
  const originalDeploymentId = process.env.VERCEL_DEPLOYMENT_ID;
  try {
    delete process.env.NEXT_PUBLIC_RELEASE_SHA;
    process.env.VERCEL_DEPLOYMENT_ID = "dpl_Abc123";
    const response = GET();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      error: "release_provenance_unavailable",
    });
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_RELEASE_SHA;
    else process.env.NEXT_PUBLIC_RELEASE_SHA = original;
    if (originalDeploymentId === undefined)
      delete process.env.VERCEL_DEPLOYMENT_ID;
    else process.env.VERCEL_DEPLOYMENT_ID = originalDeploymentId;
  }
});
