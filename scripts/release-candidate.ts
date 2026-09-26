// Pure release-proof validation. Workflow steps own all authenticated I/O.
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

const FULL_SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;

type JsonObject = Record<string, unknown>;
export type CandidateManifest = {
  version: 1;
  repository: string;
  sha: string;
  deploymentUrl: string;
  ciRunId: number;
  candidateRunId: number;
  candidateRunAttempt: number;
};

function object(value: unknown, code: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(code);
  return value as JsonObject;
}

function exactKeys(value: JsonObject, expected: string[], code: string) {
  const actual = Object.keys(value).sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== [...expected].sort()[index])
  )
    throw new Error(code);
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function deploymentHost(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !/^[a-z0-9-]+\.vercel\.app$/.test(url.hostname) ||
      url.username ||
      url.password ||
      url.port ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash
    )
      return null;
    return url.hostname;
  } catch {
    return null;
  }
}

export function createCandidateManifest(
  values: Omit<CandidateManifest, "version">,
): CandidateManifest {
  return parseCandidateManifest({ version: 1, ...values });
}

export function parseCandidateManifest(value: unknown): CandidateManifest {
  const row = object(value, "candidate_manifest_invalid");
  exactKeys(
    row,
    [
      "version",
      "repository",
      "sha",
      "deploymentUrl",
      "ciRunId",
      "candidateRunId",
      "candidateRunAttempt",
    ],
    "candidate_manifest_invalid",
  );
  if (
    row.version !== 1 ||
    typeof row.repository !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(row.repository) ||
    typeof row.sha !== "string" ||
    !FULL_SHA.test(row.sha) ||
    !deploymentHost(row.deploymentUrl) ||
    !positiveInteger(row.ciRunId) ||
    !positiveInteger(row.candidateRunId) ||
    !positiveInteger(row.candidateRunAttempt)
  )
    throw new Error("candidate_manifest_invalid");
  return row as CandidateManifest;
}

type CandidateArtifact = {
  id: number;
  digest: string;
  workflowRunId: number;
};

function matchingArtifacts(pages: unknown, name: string): JsonObject[] {
  if (!Array.isArray(pages)) throw new Error("candidate_artifacts_invalid");
  const matches: JsonObject[] = [];
  for (const pageValue of pages) {
    const page = object(pageValue, "candidate_artifacts_invalid");
    if (!Array.isArray(page.artifacts))
      throw new Error("candidate_artifacts_invalid");
    for (const artifactValue of page.artifacts) {
      const artifact = object(artifactValue, "candidate_artifacts_invalid");
      if (artifact.name === name && artifact.expired === false)
        matches.push(artifact);
    }
  }
  return matches;
}

export function selectCandidateArtifact(
  pages: unknown,
  name: string,
): CandidateArtifact {
  const matches = matchingArtifacts(pages, name);
  if (matches.length === 0) throw new Error("candidate_artifact_missing");
  if (matches.length !== 1) throw new Error("candidate_artifact_ambiguous");
  const artifact = matches[0];
  const workflowRun = object(
    artifact.workflow_run,
    "candidate_artifact_invalid",
  );
  if (
    !positiveInteger(artifact.id) ||
    typeof artifact.digest !== "string" ||
    !DIGEST.test(artifact.digest) ||
    !positiveInteger(workflowRun.id)
  )
    throw new Error("candidate_artifact_invalid");
  return {
    id: artifact.id,
    digest: artifact.digest,
    workflowRunId: workflowRun.id,
  };
}

function verifyRunRepository(run: JsonObject, repository: string): boolean {
  const owner = object(run.repository, "candidate_run_invalid");
  return owner.full_name === repository;
}

export function verifyCandidateRuns(
  manifest: CandidateManifest,
  ciValue: unknown,
  candidateValue: unknown,
) {
  const ci = object(ciValue, "candidate_ci_run_mismatch");
  if (
    ci.id !== manifest.ciRunId ||
    ci.name !== "CI" ||
    ci.event !== "push" ||
    ci.head_branch !== "main" ||
    ci.head_sha !== manifest.sha ||
    ci.conclusion !== "success" ||
    !verifyRunRepository(ci, manifest.repository)
  )
    throw new Error("candidate_ci_run_mismatch");
  const candidate = object(candidateValue, "candidate_workflow_run_mismatch");
  if (
    candidate.id !== manifest.candidateRunId ||
    candidate.name !== "CD" ||
    candidate.event !== "workflow_run" ||
    candidate.conclusion !== "success" ||
    candidate.run_attempt !== manifest.candidateRunAttempt ||
    !verifyRunRepository(candidate, manifest.repository)
  )
    throw new Error("candidate_workflow_run_mismatch");
}

export function verifyProductionDeployment(
  value: unknown,
  expected: { sha: string; projectId: string; deploymentUrl: string },
): string {
  const deployment = object(value, "candidate_deployment_mismatch");
  const meta = object(deployment.meta, "candidate_deployment_mismatch");
  if (
    typeof deployment.id !== "string" ||
    !/^dpl_[A-Za-z0-9]+$/.test(deployment.id) ||
    deployment.readyState !== "READY" ||
    deployment.target !== "production" ||
    deployment.projectId !== expected.projectId ||
    meta.githubCommitSha !== expected.sha ||
    meta.githubDeployment !== "1" ||
    deployment.url !== deploymentHost(expected.deploymentUrl)
  )
    throw new Error("candidate_deployment_mismatch");
  return deployment.id;
}

export function verifyReleaseReadback(
  value: unknown,
  expectedSha: string,
  expectedDeploymentId: string,
): { sha: string; deployment_id: string } {
  const readback = object(value, "release_readback_mismatch");
  exactKeys(readback, ["sha", "deployment_id"], "release_readback_mismatch");
  if (
    readback.sha !== expectedSha ||
    !FULL_SHA.test(expectedSha) ||
    readback.deployment_id !== expectedDeploymentId ||
    !/^dpl_[A-Za-z0-9]+$/.test(expectedDeploymentId)
  )
    throw new Error("release_readback_mismatch");
  return { sha: expectedSha, deployment_id: expectedDeploymentId };
}

async function jsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function githubOutput(path: string | undefined, values: JsonObject) {
  if (!path) return;
  const lines = Object.entries(values).map(
    ([key, value]) => `${key}=${value}\n`,
  );
  await appendFile(path, lines.join(""));
}

function required(values: JsonObject, name: string): string {
  const value = values[name];
  if (typeof value !== "string" || !value) throw new Error(`missing_${name}`);
  return value;
}

export async function main(args = process.argv.slice(2)) {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      file: { type: "string" },
      name: { type: "string" },
      output: { type: "string" },
      "github-output": { type: "string" },
      repository: { type: "string" },
      sha: { type: "string" },
      "deployment-url": { type: "string" },
      "ci-run-id": { type: "string" },
      "candidate-run-id": { type: "string" },
      "candidate-run-attempt": { type: "string" },
      "artifact-run-id": { type: "string" },
      manifest: { type: "string" },
      "ci-file": { type: "string" },
      "candidate-file": { type: "string" },
      "deployment-file": { type: "string" },
      "readback-file": { type: "string" },
      "project-id": { type: "string" },
      "deployment-id": { type: "string" },
    },
  });
  const [domain, command] = positionals;
  if (positionals.length !== 2) throw new Error("release_candidate_usage");
  const options = values as JsonObject;
  if (domain === "artifacts") {
    const pages = await jsonFile(required(options, "file"));
    const name = required(options, "name");
    if (command === "require-absent") {
      if (matchingArtifacts(pages, name).length)
        throw new Error("candidate_artifact_exists");
      return { available: true };
    }
    if (command === "select") {
      const selected = selectCandidateArtifact(pages, name);
      if (values.output)
        await writeFile(values.output, JSON.stringify(selected));
      await githubOutput(values["github-output"], {
        artifact_id: selected.id,
        artifact_digest: selected.digest,
        artifact_run_id: selected.workflowRunId,
      });
      return selected;
    }
  }
  if (domain === "manifest" && command === "create") {
    const manifest = createCandidateManifest({
      repository: required(options, "repository"),
      sha: required(options, "sha"),
      deploymentUrl: required(options, "deployment-url"),
      ciRunId: Number(required(options, "ci-run-id")),
      candidateRunId: Number(required(options, "candidate-run-id")),
      candidateRunAttempt: Number(required(options, "candidate-run-attempt")),
    });
    await writeFile(required(options, "file"), JSON.stringify(manifest));
    return manifest;
  }
  if (domain === "manifest" && command === "verify") {
    const manifest = parseCandidateManifest(
      await jsonFile(required(options, "file")),
    );
    if (
      manifest.repository !== required(options, "repository") ||
      manifest.sha !== required(options, "sha") ||
      manifest.candidateRunId !== Number(required(options, "artifact-run-id"))
    )
      throw new Error("candidate_manifest_mismatch");
    await githubOutput(values["github-output"], {
      deployment_url: manifest.deploymentUrl,
      ci_run_id: manifest.ciRunId,
      candidate_run_id: manifest.candidateRunId,
      candidate_run_attempt: manifest.candidateRunAttempt,
    });
    return manifest;
  }
  if (domain === "runs" && command === "verify") {
    const manifest = parseCandidateManifest(
      await jsonFile(required(options, "manifest")),
    );
    verifyCandidateRuns(
      manifest,
      await jsonFile(required(options, "ci-file")),
      await jsonFile(required(options, "candidate-file")),
    );
    return { verified: true };
  }
  if (domain === "deployment" && command === "verify") {
    const id = verifyProductionDeployment(
      await jsonFile(required(options, "deployment-file")),
      {
        sha: required(options, "sha"),
        projectId: required(options, "project-id"),
        deploymentUrl: required(options, "deployment-url"),
      },
    );
    if (values["deployment-id"] && values["deployment-id"] !== id)
      throw new Error("candidate_deployment_id_changed");
    verifyReleaseReadback(
      await jsonFile(required(options, "readback-file")),
      required(options, "sha"),
      id,
    );
    await githubOutput(values["github-output"], { deployment_id: id });
    return { deploymentId: id, verified: true };
  }
  if (domain === "readback" && command === "verify") {
    return verifyReleaseReadback(
      await jsonFile(required(options, "readback-file")),
      required(options, "sha"),
      required(options, "deployment-id"),
    );
  }
  throw new Error("release_candidate_usage");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error: unknown) => {
      const code =
        error instanceof Error && /^[a-z][a-z0-9_]{0,100}$/.test(error.message)
          ? error.message
          : "release_candidate_command_failed";
      console.error(code);
      process.exitCode = 1;
    });
}
