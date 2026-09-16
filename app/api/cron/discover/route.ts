import { isCronRequest } from "@/lib/cron-auth";
import { runScan, scanDeadlineMs, scanLimits } from "@/lib/scan";

export const maxDuration = 120;

export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runScan({
      ...scanLimits("discover"),
      deadlineMs: scanDeadlineMs("discover"),
    });
    return Response.json(result);
  } catch {
    return Response.json({ error: "Scan unavailable" }, { status: 503 });
  }
}
