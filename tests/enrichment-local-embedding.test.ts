import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CapturedArtifact,
  CollectionStore,
} from "../lib/enrichment/collection";
import {
  localEmbeddingAdapter,
  localEmbeddingConfiguration,
  LOCAL_EMBEDDING_OPERATION,
} from "../lib/enrichment/local-embedding";

test("local embedding archives malformed output before validation and reuses without execution", async () => {
  const root = await mkdtemp(join(tmpdir(), "embedding-test-"));
  let saved: CapturedArtifact | null = null;
  let executions = 0;
  const store: CollectionStore = {
    planCollection: async () => ({ id: "request" }),
    getReusableArtifact: async () => saved,
    reserveAttempt: async () => ({
      id: "attempt",
      clientKey: "key",
      requestId: "request",
    }),
    markDispatched: async () => {
      executions++;
    },
    markUncertain: async () => {},
    captureResponse: async (input) =>
      (saved = {
        id: "response",
        body: input.body,
        metadata: input.metadata ?? {},
      }),
  };
  try {
    const pythonExecutable = join(root, "synthetic-runtime");
    await writeFile(
      pythonExecutable,
      '#!/bin/sh\nprintf \'{"invalid":"synthetic"}\'\n',
      { mode: 0o700 },
    );
    const config = {
      scope: "test",
      budgetId: "budget",
      pythonExecutable,
      modelDirectory: root,
      policy: {
        id: "test-policy",
        scope: "test",
        operation: LOCAL_EMBEDDING_OPERATION,
        storageVerified: true,
        retentionApproved: true,
      },
    };
    const embed = localEmbeddingAdapter(store, config);
    const input = {
      ...localEmbeddingConfiguration(),
      entityId: "founder",
      analysisId: "analysis",
      generation: 0,
      templateVersion: "test",
      text: "Synthetic source",
    };
    await assert.rejects(
      embed({ ...input, modelVersion: "wrong" }),
      /configuration_mismatch/,
    );
    assert.equal(executions, 0);
    await assert.rejects(embed(input), /invalid_response/);
    assert.equal(
      Buffer.from(saved!.body).toString(),
      '{"invalid":"synthetic"}',
    );
    assert.equal(saved!.metadata.paymentState, "not_charged");
    await rm(pythonExecutable);
    await assert.rejects(embed(input), /invalid_response/);
    assert.equal(executions, 1);
    saved = null;
    await assert.rejects(
      localEmbeddingAdapter(store, {
        ...config,
        policy: { ...config.policy, retentionApproved: false },
      })(input),
      /policy_not_approved/,
    );
    assert.equal(executions, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
