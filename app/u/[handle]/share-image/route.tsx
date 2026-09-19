import { loadFounderDnaProfile } from "@/lib/founder-dna-data";
import { respondFounderShareImage } from "@/lib/founder-share-image";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle } = await params;
  return respondFounderShareImage(request, await loadFounderDnaProfile(handle));
}
