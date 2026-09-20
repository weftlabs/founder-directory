import { releaseProvenance } from "@/lib/release-provenance";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

export function GET() {
  const provenance = releaseProvenance(
    process.env.NEXT_PUBLIC_RELEASE_SHA,
    process.env.VERCEL_DEPLOYMENT_ID,
  );
  return provenance
    ? Response.json(provenance, { headers })
    : Response.json(
        { error: "release_provenance_unavailable" },
        { status: 503, headers },
      );
}
