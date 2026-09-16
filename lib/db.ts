import "./assert-server";
import { neon } from "@neondatabase/serverless";
import type { Founder, VibeCheck } from "./model";
import { isPresenceSessionId } from "./presence";

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

export async function ensureSchema() {
  const db = sql();
  await db`CREATE TABLE IF NOT EXISTS founders (
    handle TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    bio TEXT,
    website TEXT,
    github TEXT,
    linkedin TEXT,
    city TEXT,
    country TEXT,
    location TEXT,
    avatar_url TEXT,
    category TEXT NOT NULL,
    vibe_label TEXT NOT NULL,
    vibe_score INTEGER NOT NULL,
    vibe_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
    intro_text TEXT,
    intro_url TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await db`ALTER TABLE founders ADD COLUMN IF NOT EXISTS intro_url TEXT`;
  await db`CREATE TABLE IF NOT EXISTS scan_meta (
    id INTEGER PRIMARY KEY DEFAULT 1,
    last_scan_at TIMESTAMPTZ
  )`;
  await db`ALTER TABLE scan_meta ADD COLUMN IF NOT EXISTS search_cursors JSONB NOT NULL DEFAULT '{}'::jsonb`;
  await db`ALTER TABLE scan_meta ADD COLUMN IF NOT EXISTS pending_intros JSONB NOT NULL DEFAULT '[]'::jsonb`;
  await db`INSERT INTO scan_meta (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;
  await db`CREATE TABLE IF NOT EXISTS presence (
    session_id TEXT PRIMARY KEY,
    seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
}

type Row = {
  handle: string;
  name: string;
  bio: string | null;
  website: string | null;
  github: string | null;
  linkedin: string | null;
  city: string | null;
  country: string | null;
  location: string | null;
  avatar_url: string | null;
  category: string;
  vibe_label: string;
  vibe_score: number;
  vibe_signals: VibeCheck["signals"] | string;
  intro_text: string | null;
  intro_url: string | null;
  updated_at: string | Date | null;
};

function toFounder(row: Row): Founder {
  const signals =
    typeof row.vibe_signals === "string"
      ? (JSON.parse(row.vibe_signals) as VibeCheck["signals"])
      : row.vibe_signals;
  return {
    handle: row.handle,
    name: row.name,
    bio: row.bio,
    website: row.website,
    github: row.github,
    linkedin: row.linkedin,
    city: row.city,
    country: row.country,
    location: row.location,
    avatarUrl: row.avatar_url,
    category: row.category,
    introText: row.intro_text,
    introUrl: row.intro_url,
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : row.updated_at,
    vibe: {
      score: row.vibe_score,
      label: row.vibe_label,
      signals: signals ?? [],
    },
  };
}

export async function listFounders(): Promise<Founder[]> {
  await ensureSchema();
  const rows = (await sql()`
    SELECT * FROM founders ORDER BY updated_at DESC
  `) as Row[];
  return rows.map(toFounder);
}

export async function getFounder(handle: string): Promise<Founder | null> {
  await ensureSchema();
  const rows = (await sql()`
    SELECT * FROM founders WHERE lower(handle) = ${handle.toLowerCase()} LIMIT 1
  `) as Row[];
  return rows[0] ? toFounder(rows[0]) : null;
}

export async function existingHandles(): Promise<Set<string>> {
  await ensureSchema();
  const rows = (await sql()`SELECT handle FROM founders`) as {
    handle: string;
  }[];
  return new Set(rows.map((row) => row.handle.toLowerCase()));
}

export async function upsertFounder(founder: Founder) {
  await ensureSchema();
  await sql()`
    INSERT INTO founders (
      handle, name, bio, website, github, linkedin, city, country, location,
      avatar_url, category, vibe_label, vibe_score, vibe_signals, intro_text,
      intro_url, updated_at
    ) VALUES (
      ${founder.handle}, ${founder.name}, ${founder.bio}, ${founder.website},
      ${founder.github}, ${founder.linkedin}, ${founder.city}, ${founder.country},
      ${founder.location}, ${founder.avatarUrl}, ${founder.category},
      ${founder.vibe.label}, ${founder.vibe.score},
      ${JSON.stringify(founder.vibe.signals)}::jsonb, ${founder.introText},
      ${founder.introUrl}, now()
    )
    ON CONFLICT (handle) DO UPDATE SET
      name = excluded.name,
      bio = excluded.bio,
      website = excluded.website,
      github = excluded.github,
      linkedin = excluded.linkedin,
      city = excluded.city,
      country = excluded.country,
      location = excluded.location,
      avatar_url = excluded.avatar_url,
      category = excluded.category,
      vibe_label = excluded.vibe_label,
      vibe_score = excluded.vibe_score,
      vibe_signals = excluded.vibe_signals,
      intro_text = COALESCE(excluded.intro_text, founders.intro_text),
      intro_url = COALESCE(excluded.intro_url, founders.intro_url),
      updated_at = now()
  `;
}

export async function updateFounderPlace(
  handle: string,
  city: string | null,
  country: string | null,
) {
  await ensureSchema();
  await sql()`
    UPDATE founders
    SET city = ${city}, country = ${country}
    WHERE lower(handle) = ${handle.toLowerCase()}
  `;
}

export async function touchScan() {
  await ensureSchema();
  await sql()`UPDATE scan_meta SET last_scan_at = now() WHERE id = 1`;
}

export async function loadScanProgress(): Promise<{
  searchCursors: unknown;
  pendingIntros: unknown;
}> {
  await ensureSchema();
  const rows = (await sql()`
    SELECT search_cursors, pending_intros FROM scan_meta WHERE id = 1
  `) as { search_cursors: unknown; pending_intros: unknown }[];
  return {
    searchCursors: rows[0]?.search_cursors ?? {},
    pendingIntros: rows[0]?.pending_intros ?? [],
  };
}

export async function saveScanProgress(progress: {
  searchCursors: unknown;
  pendingIntros: unknown;
}) {
  await ensureSchema();
  await sql()`
    UPDATE scan_meta
    SET
      search_cursors = ${JSON.stringify(progress.searchCursors)}::jsonb,
      pending_intros = ${JSON.stringify(progress.pendingIntros)}::jsonb
    WHERE id = 1
  `;
}

export async function touchPresence(sessionId: string) {
  if (!isPresenceSessionId(sessionId)) return;
  await ensureSchema();
  const db = sql();
  await db`INSERT INTO presence (session_id, seen_at)
    VALUES (${sessionId}, now())
    ON CONFLICT (session_id) DO UPDATE SET seen_at = now()`;
  await db`DELETE FROM presence WHERE seen_at < now() - interval '10 minutes'`;
}

export async function onlineCount() {
  await ensureSchema();
  const rows = (await sql()`
    SELECT COUNT(*)::int AS n
    FROM presence
    WHERE seen_at > now() - interval '45 seconds'
  `) as { n: number }[];
  return rows[0]?.n ?? 0;
}

export async function lastScanAt(): Promise<string | null> {
  await ensureSchema();
  const rows =
    (await sql()`SELECT last_scan_at FROM scan_meta WHERE id = 1`) as {
      last_scan_at: string | Date | null;
    }[];
  const value = rows[0]?.last_scan_at;
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}
