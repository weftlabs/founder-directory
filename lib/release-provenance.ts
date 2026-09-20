const FULL_SHA = /^[a-f0-9]{40}$/;
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]+$/;

export type ReleaseProvenance = { sha: string; deployment_id: string };

export function releaseProvenance(
  sha: string | undefined,
  deploymentId: string | undefined,
): ReleaseProvenance | null {
  return sha &&
    FULL_SHA.test(sha) &&
    deploymentId &&
    DEPLOYMENT_ID.test(deploymentId)
    ? { sha, deployment_id: deploymentId }
    : null;
}

export function parseReleaseProvenance(
  value: unknown,
): ReleaseProvenance | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(",") !== "deployment_id,sha" ||
    typeof row.sha !== "string" ||
    typeof row.deployment_id !== "string"
  )
    return null;
  return releaseProvenance(row.sha, row.deployment_id);
}
