import { runScan } from "@/lib/scan";

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
      bulk ? { maxPages: 25, maxNew: 120 } : { maxPages: 1, maxNew: 8 },
    );
    return Response.json(result);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Scan failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
