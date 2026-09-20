import assert from "node:assert/strict";
import { test } from "node:test";
import { isActiveProductionDeployment } from "../lib/production-release";

const sha = "0123456789abcdef0123456789abcdef01234567";
const deploymentId = "dpl_Abc123";
const env = {
  VERCEL: "1",
  NEXT_PUBLIC_RELEASE_SHA: sha,
  VERCEL_DEPLOYMENT_ID: deploymentId,
  VERCEL_PROJECT_PRODUCTION_URL: "foundersdirectory.app",
};

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("local cron work does not need a production readback", async () => {
  let called = false;
  assert.equal(
    await isActiveProductionDeployment({
      env: {},
      fetcher: async () => {
        called = true;
        throw new Error("unexpected fetch");
      },
    }),
    true,
  );
  assert.equal(called, false);
});

test("Vercel cron work requires the exact active production deployment", async () => {
  let requested = "";
  assert.equal(
    await isActiveProductionDeployment({
      env,
      fetcher: async (input, init) => {
        requested = String(input);
        assert.equal(init?.cache, "no-store");
        return response({ sha, deployment_id: deploymentId });
      },
    }),
    true,
  );
  assert.equal(requested, "https://foundersdirectory.app/api/release");
});

test("Vercel cron work fails closed before or after an unsafe readback", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return response({ sha, deployment_id: deploymentId });
  };
  for (const invalid of [
    { ...env, NEXT_PUBLIC_RELEASE_SHA: "short" },
    { ...env, VERCEL_DEPLOYMENT_ID: "invalid" },
    { ...env, VERCEL_PROJECT_PRODUCTION_URL: "evil.test/path" },
    { ...env, VERCEL_PROJECT_PRODUCTION_URL: undefined },
  ])
    assert.equal(
      await isActiveProductionDeployment({ env: invalid, fetcher }),
      false,
    );
  assert.equal(calls, 0);

  for (const result of [
    response({ sha, deployment_id: "dpl_other" }),
    response({ sha: "f".repeat(40), deployment_id: deploymentId }),
    response({ sha, deployment_id: deploymentId, extra: true }),
    response({ error: "unavailable" }, 503),
  ])
    assert.equal(
      await isActiveProductionDeployment({
        env,
        fetcher: async () => result,
      }),
      false,
    );
  assert.equal(
    await isActiveProductionDeployment({
      env,
      fetcher: async () => {
        throw new Error("network unavailable");
      },
    }),
    false,
  );
});
