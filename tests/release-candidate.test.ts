import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCandidateManifest,
  parseCandidateManifest,
  selectCandidateArtifact,
  verifyCandidateRuns,
  verifyProductionDeployment,
  verifyReleaseReadback,
} from "../scripts/release-candidate";

const sha = "0123456789abcdef0123456789abcdef01234567";
const deploymentUrl = "https://founder-directory-abc123.vercel.app";
const deploymentId = "dpl_123";

test("candidate manifest has one strict versioned shape", () => {
  const manifest = createCandidateManifest({
    repository: "weftlabs/founder-directory",
    sha,
    deploymentUrl,
    ciRunId: 101,
    candidateRunId: 202,
    candidateRunAttempt: 1,
  });
  assert.deepEqual(parseCandidateManifest(manifest), manifest);
  for (const invalid of [
    { ...manifest, extra: true },
    { ...manifest, sha: "short" },
    { ...manifest, deploymentUrl: "http://example.com" },
    { ...manifest, deploymentUrl: "https://example.com" },
    { ...manifest, deploymentUrl: "https://.vercel.app" },
    { ...manifest, ciRunId: 0 },
  ])
    assert.throws(() => parseCandidateManifest(invalid), /candidate_manifest/);
});

test("artifact selection filters locally and rejects zero or duplicate live records", () => {
  const name = `production-candidate-${sha}`;
  const artifact = {
    id: 7,
    name,
    expired: false,
    digest: `sha256:${"a".repeat(64)}`,
    workflow_run: { id: 202 },
  };
  assert.deepEqual(selectCandidateArtifact([{ artifacts: [artifact] }], name), {
    id: 7,
    digest: artifact.digest,
    workflowRunId: 202,
  });
  assert.throws(
    () => selectCandidateArtifact([{ artifacts: [] }], name),
    /candidate_artifact_missing/,
  );
  assert.throws(
    () =>
      selectCandidateArtifact(
        [{ artifacts: [artifact, { ...artifact, id: 8 }] }],
        name,
      ),
    /candidate_artifact_ambiguous/,
  );
  assert.throws(
    () =>
      selectCandidateArtifact(
        [{ artifacts: [{ ...artifact, expired: true }] }],
        name,
      ),
    /candidate_artifact_missing/,
  );
});

test("candidate run proof binds exact successful CI and candidate runs", () => {
  const manifest = createCandidateManifest({
    repository: "weftlabs/founder-directory",
    sha,
    deploymentUrl,
    ciRunId: 101,
    candidateRunId: 202,
    candidateRunAttempt: 1,
  });
  const ci = {
      id: 101,
      name: "CI",
      event: "push",
      head_branch: "main",
      head_sha: sha,
      conclusion: "success",
      run_attempt: 1,
      repository: { full_name: manifest.repository },
    },
    candidate = {
      id: 202,
      name: "CD",
      event: "workflow_run",
      conclusion: "success",
      run_attempt: 1,
      repository: { full_name: manifest.repository },
    };
  assert.doesNotThrow(() => verifyCandidateRuns(manifest, ci, candidate));
  assert.throws(
    () =>
      verifyCandidateRuns(
        manifest,
        { ...ci, head_sha: "f".repeat(40) },
        candidate,
      ),
    /candidate_ci_run_mismatch/,
  );
  assert.throws(
    () =>
      verifyCandidateRuns(manifest, ci, {
        ...candidate,
        conclusion: "failure",
      }),
    /candidate_workflow_run_mismatch/,
  );
});

test("deployment proof requires the exact ready staged production deployment", () => {
  const deployment = {
    id: "dpl_123",
    url: "founder-directory-abc123.vercel.app",
    readyState: "READY",
    target: "production",
    projectId: "prj_123",
    meta: { githubCommitSha: sha, githubDeployment: "1" },
  };
  assert.equal(
    verifyProductionDeployment(deployment, {
      sha,
      projectId: "prj_123",
      deploymentUrl,
    }),
    "dpl_123",
  );
  for (const invalid of [
    { ...deployment, readyState: "BUILDING" },
    { ...deployment, target: "preview" },
    { ...deployment, projectId: "prj_other" },
    {
      ...deployment,
      meta: { githubCommitSha: "f".repeat(40), githubDeployment: "1" },
    },
    { ...deployment, meta: { githubCommitSha: sha } },
    { ...deployment, url: "another.vercel.app" },
  ])
    assert.throws(
      () =>
        verifyProductionDeployment(invalid, {
          sha,
          projectId: "prj_123",
          deploymentUrl,
        }),
      /candidate_deployment_mismatch/,
    );
});

test("app readback binds the exact embedded SHA and deployment", () => {
  assert.deepEqual(
    verifyReleaseReadback(
      { sha, deployment_id: deploymentId },
      sha,
      deploymentId,
    ),
    { sha, deployment_id: deploymentId },
  );
  for (const invalid of [
    { sha: "f".repeat(40), deployment_id: deploymentId },
    { sha, deployment_id: "dpl_other" },
    { sha, deployment_id: deploymentId, release: "private" },
    { sha },
    {},
  ])
    assert.throws(
      () => verifyReleaseReadback(invalid, sha, deploymentId),
      /release_readback_mismatch/,
    );
  assert.throws(
    () =>
      verifyReleaseReadback(
        { sha, deployment_id: deploymentId },
        sha,
        "invalid",
      ),
    /release_readback_mismatch/,
  );
});
