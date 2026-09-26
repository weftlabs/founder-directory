import {
  parseReleaseProvenance,
  releaseProvenance,
} from "./release-provenance";

type ReleaseEnvironment = {
  [key: string]: string | undefined;
  VERCEL?: string;
  NEXT_PUBLIC_RELEASE_SHA?: string;
  VERCEL_DEPLOYMENT_ID?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
};

type Fetcher = typeof fetch;

function productionReleaseUrl(host: string | undefined): string | null {
  if (!host) return null;
  try {
    const url = new URL(`https://${host}/api/release`);
    return url.host === host && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export async function isActiveProductionDeployment({
  env = process.env,
  fetcher = fetch,
}: {
  env?: ReleaseEnvironment;
  fetcher?: Fetcher;
} = {}): Promise<boolean> {
  if (env.VERCEL !== "1") return true;
  const local = releaseProvenance(
    env.NEXT_PUBLIC_RELEASE_SHA,
    env.VERCEL_DEPLOYMENT_ID,
  );
  const url = productionReleaseUrl(env.VERCEL_PROJECT_PRODUCTION_URL);
  if (!local || !url) return false;
  try {
    const response = await fetcher(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return false;
    const active = parseReleaseProvenance(await response.json());
    return (
      active?.sha === local.sha && active.deployment_id === local.deployment_id
    );
  } catch {
    return false;
  }
}
