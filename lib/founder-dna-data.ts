// Saved eligible publications only. Page loads cannot invoke collection or inference.
import "./assert-server";
import { directoryDatabaseUrl } from "./founder-database-config";
import { neon } from "@neondatabase/serverless";
import { postgresDatabase, type Sql } from "./enrichment/db";
import { parseFounderDnaProfile, type FounderDnaResult } from "./founder-dna";
async function parseProfileRead(
  db: Sql,
  text: string,
  values: unknown[],
): Promise<FounderDnaResult> {
  const { rows } = await db.query<{ status: string; profile: unknown }>(
    text,
    values,
  );
  const row = rows[0];
  if (!row) return { status: "not_found" };
  if (row.status === "hidden") return { status: "hidden" };
  if (row.status !== "ready") return { status: "unavailable" };
  return { status: "ready", profile: parseFounderDnaProfile(row.profile) };
}
export async function readFounderDnaProfile(
  db: Sql,
  handle: string,
): Promise<FounderDnaResult> {
  if (!/^[a-zA-Z0-9_]{1,15}$/.test(handle)) return { status: "not_found" };
  return parseProfileRead(
    db,
    "SELECT status, profile FROM founder_dna_profile_reads WHERE handle=lower($1)",
    [handle],
  );
}
export async function readFounderDnaReleaseProfile(
  db: Sql,
  releaseId: string,
  handle: string,
): Promise<FounderDnaResult> {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(releaseId) ||
    !/^[a-zA-Z0-9_]{1,15}$/.test(handle)
  )
    return { status: "not_found" };
  const release = (
    await db.query<{ status: string }>(
      "SELECT status FROM founder_dna_releases WHERE id=$1",
      [releaseId],
    )
  ).rows[0];
  if (!release || release.status !== "validated")
    return { status: "unavailable" };
  return parseProfileRead(
    db,
    "SELECT status,profile FROM founder_dna_release_profile_reads($1) WHERE handle=lower($2)",
    [releaseId, handle],
  );
}
export async function loadFounderDnaProfile(
  handle: string,
  env: Record<string, string | undefined> = process.env,
  db?: Sql,
): Promise<FounderDnaResult> {
  if (env.FOUNDER_DNA_ENABLED !== "1") return { status: "disabled" };
  try {
    // Injected SQL is an explicit offline boundary; runtime clients must share identity.
    if (!db) directoryDatabaseUrl(env);
    if (!db && env.FOUNDER_DNA_DATABASE_TRANSPORT === "postgres") {
      const connection = postgresDatabase(env.FOUNDER_DNA_DATABASE_URL!);
      try {
        return await readFounderDnaProfile(connection, handle);
      } finally {
        await connection.close();
      }
    }
    if (
      !db &&
      env.FOUNDER_DNA_DATABASE_TRANSPORT &&
      env.FOUNDER_DNA_DATABASE_TRANSPORT !== "neon"
    )
      return { status: "unavailable" };
    if (!db) {
      const sql = neon(env.FOUNDER_DNA_DATABASE_URL!, {
        fetchOptions: { signal: AbortSignal.timeout(10000) },
      });
      db = {
        async query<T>(text: string, values?: unknown[]) {
          return { rows: (await sql.query(text, values)) as T[] };
        },
      };
    }
    return await readFounderDnaProfile(db, handle);
  } catch {
    return { status: "unavailable" };
  }
}
