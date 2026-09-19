// Runtime configuration for the shared founder and DNA database. No connections or fallback.
import "./assert-server";

function databaseIdentity(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const database = decodeURIComponent(url.pathname.slice(1));
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname ||
      !database
    )
      return null;
    return JSON.stringify([
      url.hostname.toLowerCase(),
      url.port || "5432",
      database,
    ]);
  } catch {
    return null;
  }
}

export function directoryDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const url = env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (env.FOUNDER_DNA_ENABLED === "1") {
    const identity = databaseIdentity(url);
    if (
      !identity ||
      identity !== databaseIdentity(env.FOUNDER_DNA_DATABASE_URL)
    ) {
      throw new Error(
        "Founder DNA requires DATABASE_URL and FOUNDER_DNA_DATABASE_URL to identify the same host, port and database",
      );
    }
  }
  return url;
}
