import {
  directoryFiltersFromSearchParams,
  emptyDirectoryPage,
} from "@/lib/directory-page";
import { listDirectoryPage } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return Response.json(
      await listDirectoryPage({
        ...directoryFiltersFromSearchParams(url.searchParams),
        cursor: url.searchParams.get("cursor"),
      }),
    );
  } catch {
    return Response.json(emptyDirectoryPage());
  }
}
