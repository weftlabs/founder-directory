import assert from "node:assert/strict";
import { test } from "node:test";
import {
  campaignManifest,
  processingCoverage,
  planStages,
  canPublish,
  STAGES,
  runPendingStages,
  type ClaimedStage,
} from "../lib/enrichment/pipeline";

test("frozen campaign contains 1001 founders; later arrivals cannot change it", () => {
  const founders = Array.from({ length: 1001 }, (_, i) => `founder-${i}`);
  const campaign = campaignManifest(founders);
  founders.push("late-arrival");
  assert.equal(campaign.members.length, 1001);
  assert.equal(
    campaignManifest([...campaign.members].reverse()).digest,
    campaign.digest,
  );
  assert.notEqual(campaignManifest(founders).digest, campaign.digest);
});

test("required stages remain incomplete for unavailable and unsupported not-applicable", () => {
  const rows = STAGES.map((stage) => ({
    stage,
    status: "succeeded" as const,
    evidenceIds: ["e1"],
  }));
  assert.equal(processingCoverage(rows).status, "fully_analyzed");
  assert.equal(
    processingCoverage([
      { ...rows[0], status: "unavailable" },
      ...rows.slice(1),
    ]).status,
    "partial",
  );
  assert.equal(
    processingCoverage([
      { ...rows[0], status: "not_applicable", evidenceIds: [] },
      ...rows.slice(1),
    ]).status,
    "partial",
  );
  assert.equal(processingCoverage([]).status, "pending");
});

test("embedding-only change reuses upstream steps and schedules only dependent work", () => {
  const recipes = Object.fromEntries(STAGES.map((stage) => [stage, "recipe1"]));
  const saved = STAGES.map((stage) => ({
    stage,
    recipeDigest: "recipe1",
    inputDigest: "input1",
    status: "succeeded" as const,
    outputId: `output-${stage}`,
  }));
  const plan = planStages({
    recipes: { ...recipes, embeddings: "recipe2" },
    inputDigests: Object.fromEntries(STAGES.map((stage) => [stage, "input1"])),
    saved,
  });
  assert.deepEqual(
    plan.filter((row) => row.action === "run").map((row) => row.stage),
    ["embeddings"],
  );
});

test("publication rejects stale release, stale evidence, unapproved or suppressed candidates", () => {
  const candidate = {
    entityId: "e1",
    releaseId: "r1",
    generation: 1,
    validated: true,
  };
  const target = {
    entityId: "e1",
    releaseId: "r1",
    generation: 1,
    suppressed: false,
  };
  assert.equal(canPublish(candidate, target, "approved"), true);
  assert.equal(
    canPublish(candidate, { ...target, releaseId: "r2" }, "approved"),
    false,
  );
  assert.equal(
    canPublish(candidate, { ...target, generation: 2 }, "approved"),
    false,
  );
  assert.equal(canPublish(candidate, target, "proposed"), false);
  assert.equal(
    canPublish(candidate, { ...target, suppressed: true }, "approved"),
    false,
  );
});

test("durable worker bounds claims, marks missing handlers blocked and resumes remaining work", async () => {
  const pending: ClaimedStage[] = [
    "collection",
    "extraction",
    "founder_dna",
  ].map((stage, i) => ({
    id: `work${i}`,
    leaseToken: `lease${i}`,
    entityId: "e1",
    releaseId: "r1",
    generation: 1,
    stage,
  }));
  const results: { id: string; status: string }[] = [];
  const store = {
    async claimStage() {
      return pending.shift() ?? null;
    },
    async finishStage(value: { id: string; status: string }) {
      results.push(value);
    },
  };
  const handlers = {
    collection: async () => ({ status: "succeeded" as const }),
    extraction: async () => {
      throw new Error("synthetic parser failure");
    },
  };
  assert.equal(
    (await runPendingStages(store, handlers, { limit: 2, leaseSeconds: 30 }))
      .processed,
    2,
  );
  assert.deepEqual(
    results.map((row) => row.status),
    ["succeeded", "failed"],
  );
  assert.equal(pending.length, 1);
  await runPendingStages(store, handlers, { limit: 2, leaseSeconds: 30 });
  assert.equal(results[2].status, "blocked");
});

test("lease loss is not swallowed or reported as completed work", async () => {
  let claimed = false;
  const store = {
    async claimStage() {
      if (claimed) return null;
      claimed = true;
      return {
        id: "w1",
        leaseToken: "expired",
        entityId: "e1",
        releaseId: "r1",
        generation: 1,
        stage: "extraction",
      };
    },
    async finishStage() {
      throw new Error("lease_expired");
    },
  };
  await assert.rejects(
    runPendingStages(
      store,
      { extraction: async () => ({ status: "succeeded" }) },
      { limit: 1, leaseSeconds: 1 },
    ),
    /lease_expired/,
  );
});
