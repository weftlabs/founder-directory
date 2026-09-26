import { isCronRequest } from "@/lib/cron-auth";
import { isActiveProductionDeployment } from "@/lib/production-release";
import { runScan, scanDeadlineMs, scanLimits } from "@/lib/scan";

/** Pro Fluid maximum without a plan upgrade. */
export const maxDuration = 800;

export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isActiveProductionDeployment())) {
    return Response.json({ error: "Inactive release" }, { status: 503 });
  }
  try {
    const result = await runScan({
      ...scanLimits("hydrate"),
      deadlineMs: scanDeadlineMs("hydrate"),
    });
    return Response.json(result);
  } catch {
    return Response.json({ error: "Scan unavailable" }, { status: 503 });
  }
}
