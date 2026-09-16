import { onlineCount, touchPresence } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ online: await onlineCount() });
  } catch {
    return Response.json({ online: 0 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      sessionId?: unknown;
    } | null;
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
    await touchPresence(sessionId);
    return Response.json({ online: await onlineCount() });
  } catch {
    return Response.json({ online: 0 });
  }
}
