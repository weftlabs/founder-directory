import { BULK_SCAN_PAGES, runScan, SCHEDULED_SCAN_PAGES } from "@/lib/scan";

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  const ok =
    secret &&
    (auth === `Bearer ${secret}` ||
      request.headers.get("x-cron-secret") === secret);
  if (!ok) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const bulk = url.searchParams.get("bulk") === "1";
  try {
    const result = await runScan(
      bulk ? { maxPages: BULK_SCAN_PAGES } : { maxPages: SCHEDULED_SCAN_PAGES },
    );
    return Response.json(result);
  } catch {
    // Provider and database errors can contain credentials or personal data.
    return Response.json({ error: "Scan unavailable" }, { status: 503 });
  }
}
