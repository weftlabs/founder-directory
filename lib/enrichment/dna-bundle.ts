// Private, bounded release transfer. Public serving never reads these archives.
import "../assert-server";
import { createHash } from "node:crypto";
import { stableDigest, stableUuid } from "./contracts";
import type { Database, Sql } from "./db";
import { DNA_CODE_VERSION, DnaPublicationStore } from "./dna-store";
import {
  FOUNDER_DNA_SCHEMA_VERSION,
  parseFounderDnaProfile,
} from "../founder-dna";

type Row = Record<string, unknown>;
const keys = {
  enrichment_entities: ["id"],
  enrichment_artifacts: ["id"],
  enrichment_evidence: ["id"],
  enrichment_entity_evidence: ["entity_id", "evidence_id", "relation"],
  enrichment_founder_products: ["founder_id", "product_id", "evidence_id"],
  enrichment_releases: ["id"],
  enrichment_analysis_runs: ["id"],
  founder_dna_portrait_publications: ["entity_id"],
  founder_dna_connection_decisions: ["id"],
  founder_dna_release_profiles: ["release_id", "entity_id"],
  founder_dna_release_edges: ["release_id", "decision_id"],
} as const;
type Table = keyof typeof keys;
const tables = Object.keys(keys) as Table[];
export type DnaBundle = {
  manifest: {
    format: "founder-dna-private-bundle-v1";
    schemaVersion: number;
    codeVersion: string;
    release: Row;
    cohort: string[];
    counts: Record<Table, number>;
    costs: {
      settledMicros: number;
      unresolvedCapMicros: number;
      attempts: number;
      unpricedImportedArtifacts: number;
    };
    rowsHash: string;
  };
  rows: Record<Table, Row[]>;
  hash: string;
};
const MAX_ROWS = 50_000;
export const MAX_DNA_BUNDLE_BYTES = 64 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
function ids(rows: Row[], field = "id"): string[] {
  return [...new Set(rows.map((row) => String(row[field])))];
}
function references(value: unknown): string[] {
  if (typeof value === "string") return uuid.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(references);
  if (value && typeof value === "object")
    return Object.values(value).flatMap(references);
  return [];
}
async function select(db: Sql, table: Table, where: string, values: unknown[]) {
  if (table === "enrichment_artifacts") {
    const limits = (
      await db.query<{ bytes: string; count: number }>(
        `SELECT coalesce(sum(byte_length),0)::text AS bytes,count(*)::int AS count FROM enrichment_artifacts t WHERE ${where}`,
        values,
      )
    ).rows[0];
    if (
      Number(limits.bytes) > MAX_DNA_BUNDLE_BYTES / 2 ||
      limits.count > MAX_ROWS
    )
      throw new Error("bundle_artifact_budget_exceeded");
  }
  const projection =
    table === "enrichment_artifacts"
      ? "(to_jsonb(t)-'body') || jsonb_build_object('body',encode(t.body,'base64'))"
      : "to_jsonb(t)";
  return (
    await db.query<{ row: Row }>(
      `SELECT ${projection} AS row FROM ${table} t WHERE ${where} ORDER BY ${keys[table].join(",")} LIMIT ${MAX_ROWS + 1}`,
      values,
    )
  ).rows.map((r) => r.row);
}
function unique(rows: Row[], table: Table): Row[] {
  return [
    ...new Map(
      rows.map((row) => [stableDigest(keys[table].map((k) => row[k])), row]),
    ).values(),
  ].sort((a, b) => stableDigest(a).localeCompare(stableDigest(b)));
}
function seal(
  rows: DnaBundle["rows"],
  release: Row,
  costs: DnaBundle["manifest"]["costs"],
): DnaBundle {
  for (const table of tables) rows[table] = unique(rows[table], table);
  const manifest: DnaBundle["manifest"] = {
    format: "founder-dna-private-bundle-v1",
    schemaVersion: FOUNDER_DNA_SCHEMA_VERSION,
    codeVersion: DNA_CODE_VERSION,
    release,
    cohort: rows.founder_dna_release_profiles
      .map((p) => String(p.entity_id))
      .sort(),
    counts: Object.fromEntries(
      tables.map((t) => [t, rows[t].length]),
    ) as Record<Table, number>,
    costs,
    rowsHash: stableDigest(rows),
  };
  return { manifest, rows, hash: stableDigest({ manifest, rows }) };
}

/** Export the selected release's transitive retained dependencies, never a DB dump. */
export async function exportDnaBundle(
  db: Database,
  releaseId: string,
): Promise<DnaBundle> {
  return db.transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const release = (
      await tx.query<{ row: Row }>(
        "SELECT to_jsonb(r) AS row FROM founder_dna_releases r WHERE id=$1",
        [releaseId],
      )
    ).rows[0]?.row;
    if (!release) throw new Error("bundle_release_missing");
    const rows = Object.fromEntries(
      tables.map((t) => [t, []]),
    ) as unknown as DnaBundle["rows"];
    rows.founder_dna_release_profiles = await select(
      tx,
      "founder_dna_release_profiles",
      "release_id=$1",
      [releaseId],
    );
    rows.founder_dna_release_edges = await select(
      tx,
      "founder_dna_release_edges",
      "release_id=$1",
      [releaseId],
    );
    const eligible = (
      await tx.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM founder_dna_eligible_profiles WHERE release_id=$1",
        [releaseId],
      )
    ).rows[0].count;
    const edges = (
      await tx.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM founder_dna_eligible_edges WHERE release_id=$1",
        [releaseId],
      )
    ).rows[0].count;
    if (
      eligible !== release.expected_profiles ||
      eligible !== rows.founder_dna_release_profiles.length ||
      edges !== rows.founder_dna_release_edges.length
    )
      throw new Error("bundle_release_ineligible");
    rows.founder_dna_connection_decisions = await select(
      tx,
      "founder_dna_connection_decisions",
      "id=ANY($1::text[])",
      [ids(rows.founder_dna_release_edges, "decision_id")],
    );
    const founders = ids(rows.founder_dna_release_profiles, "entity_id");
    rows.founder_dna_portrait_publications = await select(
      tx,
      "founder_dna_portrait_publications",
      "entity_id=ANY($1::uuid[]) AND analysis_id=ANY($2::uuid[])",
      [
        founders,
        ids(rows.founder_dna_release_profiles, "portrait_analysis_id"),
      ],
    );
    if (rows.founder_dna_portrait_publications.length !== founders.length)
      throw new Error("bundle_portrait_approval_missing");
    rows.enrichment_entities = await select(
      tx,
      "enrichment_entities",
      "id=ANY($1::uuid[])",
      [founders],
    );
    let needed = references([
      rows.founder_dna_release_profiles,
      rows.founder_dna_connection_decisions,
      rows.enrichment_founder_products,
    ]);
    // Resolve only explicit references and per-analysis retained generation artifacts.
    for (let round = 0; round < 16; round++) {
      const before = stableDigest(rows);
      rows.enrichment_analysis_runs = unique(
        [
          ...rows.enrichment_analysis_runs,
          ...(await select(
            tx,
            "enrichment_analysis_runs",
            "id=ANY($1::uuid[])",
            [needed],
          )),
        ],
        "enrichment_analysis_runs",
      );
      rows.enrichment_founder_products = await select(
        tx,
        "enrichment_founder_products",
        "founder_id=ANY($1::uuid[]) AND product_id=ANY($2::uuid[])",
        [founders, ids(rows.enrichment_analysis_runs, "entity_id")],
      );
      needed = [
        ...new Set([
          ...needed,
          ...references(rows.enrichment_founder_products),
        ]),
      ];
      rows.enrichment_releases = await select(
        tx,
        "enrichment_releases",
        "id=ANY($1::uuid[])",
        [ids(rows.enrichment_analysis_runs, "release_id")],
      );
      needed = [
        ...new Set([
          ...needed,
          ...references(rows.enrichment_analysis_runs),
          ...references(rows.enrichment_releases),
        ]),
      ];
      rows.enrichment_evidence = await select(
        tx,
        "enrichment_evidence",
        "id=ANY($1::uuid[])",
        [needed],
      );
      needed = [
        ...new Set([...needed, ...references(rows.enrichment_evidence)]),
      ];
      rows.enrichment_artifacts = unique(
        [
          ...rows.enrichment_artifacts,
          ...(await select(
            tx,
            "enrichment_artifacts",
            "id=ANY($1::uuid[]) OR run_id=ANY($2::uuid[]) OR attempt_id=ANY($3::uuid[])",
            [
              needed,
              ids(rows.enrichment_analysis_runs),
              rows.enrichment_artifacts.flatMap((a) =>
                a.attempt_id ? [a.attempt_id] : [],
              ),
            ],
          )),
        ],
        "enrichment_artifacts",
      );
      needed = [
        ...new Set([
          ...needed,
          ...references(
            rows.enrichment_artifacts.map((artifact) => {
              const { body, ...rest } = artifact;
              let retainedReferences: unknown = null;
              if (String(artifact.content_type).includes("json")) {
                try {
                  retainedReferences = JSON.parse(
                    Buffer.from(String(body), "base64").toString("utf8"),
                  );
                } catch {
                  /* Non-JSON provider output has no structured dependencies. */
                }
              }
              return [rest, retainedReferences];
            }),
          ),
        ]),
      ];
      if (stableDigest(rows) === before) break;
      if (round === 15) throw new Error("bundle_dependency_depth_exceeded");
    }
    // Include links only for dependency entities. No unrelated source co-owners are imported.
    const owners = [
      ...new Set([
        ...ids(rows.enrichment_entities),
        ...ids(rows.enrichment_analysis_runs, "entity_id"),
      ]),
    ];
    rows.enrichment_entities = await select(
      tx,
      "enrichment_entities",
      "id=ANY($1::uuid[])",
      [owners],
    );
    rows.enrichment_entity_evidence = await select(
      tx,
      "enrichment_entity_evidence",
      "entity_id=ANY($1::uuid[]) AND evidence_id=ANY($2::uuid[])",
      [owners, ids(rows.enrichment_evidence)],
    );
    // Keep transfer provenance on later exports, without following its historical
    // origin IDs into unrelated cohorts or rewriting any captured bytes.
    const imported = rows.enrichment_artifacts.filter(
      (artifact) =>
        typeof artifact.import_batch === "string" &&
        artifact.import_batch.startsWith("dna-bundle:"),
    );
    const provenanceRows = await select(
      tx,
      "enrichment_artifacts",
      "redaction_version='private-import-provenance-v1' AND import_batch=ANY($1::text[])",
      [imported.map((artifact) => artifact.import_batch)],
    );
    rows.enrichment_artifacts = unique(
      [...rows.enrichment_artifacts, ...provenanceRows],
      "enrichment_artifacts",
    );
    const inheritedCosts = provenanceRows.flatMap((artifact) => {
      const provenance = JSON.parse(
        Buffer.from(String(artifact.body), "base64").toString("utf8"),
      ) as {
        manifest: DnaBundle["manifest"];
        entityMapping: Record<string, string>;
      };
      return provenance.manifest.release.id === releaseId &&
        stableDigest(
          provenance.manifest.cohort
            .map((id) => provenance.entityMapping[id] ?? id)
            .sort(),
        ) === stableDigest([...founders].sort())
        ? [provenance.manifest.costs]
        : [];
    });
    if (new Set(inheritedCosts.map(stableDigest)).size > 1)
      throw new Error("bundle_import_cost_provenance_conflict");
    const attempts = rows.enrichment_artifacts.flatMap((a) =>
      a.attempt_id ? [a.attempt_id] : [],
    );
    const cost = (
      await tx.query<{ settled: string; unresolved: string; count: number }>(
        "SELECT coalesce(sum(settled_micros) FILTER(WHERE payment_state='settled'),0)::text AS settled,coalesce(sum(cap_micros) FILTER(WHERE payment_state IN ('pending','uncertain')),0)::text AS unresolved,count(*)::int AS count FROM enrichment_collection_attempts WHERE id=ANY($1::uuid[])",
        [attempts],
      )
    ).rows[0];
    const bundle = seal(
      rows,
      release,
      inheritedCosts.length && !cost.count
        ? inheritedCosts[0]
        : {
            settledMicros: Number(cost.settled),
            unresolvedCapMicros: Number(cost.unresolved),
            attempts: cost.count,
            unpricedImportedArtifacts: imported.length,
          },
    );
    parseDnaBundle(bundle);
    const withdrawn = await tx.query(
      "SELECT artifact_id FROM enrichment_artifact_withdrawals WHERE artifact_id=ANY($1::uuid[])",
      [ids(rows.enrichment_artifacts)],
    );
    if (withdrawn.rows.length)
      throw new Error("bundle_contains_withdrawn_artifact");
    return bundle;
  });
}

/** Hashes detect corruption, not authenticity. Transfer only a reviewed private archive. */
export function parseDnaBundle(value: unknown): DnaBundle {
  if (
    !value ||
    typeof value !== "object" ||
    Buffer.byteLength(JSON.stringify(value)) > MAX_DNA_BUNDLE_BYTES
  )
    throw new Error("bundle_invalid_or_too_large");
  const b = value as DnaBundle;
  if (
    b.manifest?.format !== "founder-dna-private-bundle-v1" ||
    b.manifest.schemaVersion !== FOUNDER_DNA_SCHEMA_VERSION ||
    b.manifest.codeVersion !== DNA_CODE_VERSION ||
    !b.rows ||
    Object.keys(b.rows).sort().join() !== [...tables].sort().join()
  )
    throw new Error("bundle_incompatible");
  if (
    stableDigest({ manifest: b.manifest, rows: b.rows }) !== b.hash ||
    stableDigest(b.rows) !== b.manifest.rowsHash
  )
    throw new Error("bundle_hash_mismatch");
  for (const amount of Object.values(b.manifest.costs))
    if (!Number.isSafeInteger(amount) || amount < 0)
      throw new Error("bundle_cost_invalid");
  let total = 0;
  for (const table of tables) {
    if (
      !Array.isArray(b.rows[table]) ||
      b.rows[table].length !== b.manifest.counts[table] ||
      unique(b.rows[table], table).length !== b.rows[table].length
    )
      throw new Error("bundle_count_or_duplicate_mismatch");
    total += b.rows[table].length;
  }
  if (total > MAX_ROWS) throw new Error("bundle_too_many_rows");
  if (
    b.manifest.release.schema_version !== FOUNDER_DNA_SCHEMA_VERSION ||
    b.manifest.release.code_version !== DNA_CODE_VERSION ||
    stableDigest(b.manifest.release.manifest) !==
      b.manifest.release.manifest_hash
  )
    throw new Error("bundle_release_manifest_mismatch");
  const profiles = b.rows.founder_dna_release_profiles;
  if (
    !profiles.length ||
    profiles.length > 1000 ||
    profiles.length !== b.manifest.release.expected_profiles ||
    stableDigest(ids(profiles, "entity_id").sort()) !==
      stableDigest(b.manifest.cohort)
  )
    throw new Error("bundle_cohort_mismatch");
  for (const p of profiles) {
    const profile = parseFounderDnaProfile(p.profile);
    if (
      p.release_id !== b.manifest.release.id ||
      profile.releaseId !== p.release_id ||
      stableDigest(profile) !== p.profile_hash
    )
      throw new Error("bundle_profile_hash_mismatch");
  }
  for (const a of b.rows.enrichment_artifacts) {
    if (typeof a.body !== "string") throw new Error("bundle_artifact_invalid");
    const bytes = Buffer.from(a.body, "base64");
    if (
      bytes.toString("base64") !== a.body.replace(/\s/g, "") ||
      bytes.length !== a.byte_length ||
      createHash("sha256").update(bytes).digest("hex") !== a.sha256
    )
      throw new Error("bundle_artifact_hash_mismatch");
  }
  for (const row of [
    ...b.rows.enrichment_entities,
    ...b.rows.enrichment_artifacts,
    ...b.rows.enrichment_evidence,
    ...b.rows.enrichment_analysis_runs,
  ]) {
    if (
      row.status === "suppressed" ||
      row.purged_at ||
      (row.expires_at && Date.parse(String(row.expires_at)) <= Date.now())
    )
      throw new Error("bundle_retention_ineligible");
  }
  if (
    b.rows.enrichment_releases.some(
      (r) =>
        r.status !== "approved" || !r.approval || !r.evaluation_artifact_id,
    )
  )
    throw new Error("bundle_source_release_unapproved");
  const has = (table: Table, field: string, value: unknown) =>
    b.rows[table].some((row) => row[field] === value);
  const need = (table: Table, field: string, value: unknown) => {
    if (!has(table, field, value))
      throw new Error(`bundle_dependency_missing:${table}:${String(value)}`);
  };
  for (const row of b.rows.enrichment_evidence)
    need("enrichment_artifacts", "id", row.artifact_id);
  for (const row of b.rows.enrichment_entity_evidence) {
    need("enrichment_entities", "id", row.entity_id);
    need("enrichment_evidence", "id", row.evidence_id);
  }
  for (const row of b.rows.enrichment_founder_products) {
    need("enrichment_entities", "id", row.founder_id);
    need("enrichment_entities", "id", row.product_id);
    need("enrichment_evidence", "id", row.evidence_id);
  }
  for (const row of b.rows.enrichment_releases)
    need("enrichment_artifacts", "id", row.evaluation_artifact_id);
  for (const row of b.rows.enrichment_analysis_runs) {
    if (row.status !== "succeeded" || !Array.isArray(row.evidence_ids))
      throw new Error("bundle_analysis_not_approved");
    need("enrichment_entities", "id", row.entity_id);
    need("enrichment_releases", "id", row.release_id);
    need("enrichment_artifacts", "id", row.input_artifact_id);
    for (const evidence of row.evidence_ids) {
      need("enrichment_evidence", "id", evidence);
      if (
        !b.rows.enrichment_entity_evidence.some(
          (link) =>
            link.entity_id === row.entity_id && link.evidence_id === evidence,
        )
      )
        throw new Error("bundle_evidence_owner_missing");
    }
    if (row.purpose === "founder_portrait") {
      const report = row.validation_report as Row;
      if (report.checksPassed !== true)
        throw new Error("bundle_portrait_unchecked");
      for (const key of [
        "generationResponseArtifactId",
        "judgeRequestArtifactId",
        "judgeResponseArtifactId",
      ])
        need("enrichment_artifacts", "id", report[key]);
      for (const id of (report.productAnalysisIds ?? []) as unknown[])
        need("enrichment_analysis_runs", "id", id);
    }
  }
  for (const row of b.rows.founder_dna_portrait_publications) {
    need("enrichment_entities", "id", row.entity_id);
    need("enrichment_analysis_runs", "id", row.analysis_id);
  }
  for (const row of profiles) {
    need("enrichment_entities", "id", row.entity_id);
    need("enrichment_analysis_runs", "id", row.analysis_id);
    need("enrichment_analysis_runs", "id", row.portrait_analysis_id);
    if (
      !b.rows.founder_dna_portrait_publications.some(
        (p) =>
          p.entity_id === row.entity_id &&
          p.analysis_id === row.portrait_analysis_id,
      )
    )
      throw new Error("bundle_portrait_approval_missing");
    for (const source of parseFounderDnaProfile(row.profile).sources)
      need("enrichment_evidence", "id", source.id);
  }
  for (const row of b.rows.founder_dna_connection_decisions) {
    for (const side of ["left", "right"]) {
      need("enrichment_entities", "id", row[`${side}_entity_id`]);
      need("enrichment_analysis_runs", "id", row[`${side}_analysis_id`]);
      for (const id of row[`${side}_evidence_ids`] as unknown[])
        need("enrichment_evidence", "id", id);
    }
    need("enrichment_artifacts", "id", row.request_artifact_id);
    need("enrichment_artifacts", "id", row.response_artifact_id);
  }
  for (const row of b.rows.founder_dna_release_edges) {
    if (row.release_id !== b.manifest.release.id)
      throw new Error("bundle_edge_release_mismatch");
    need("founder_dna_connection_decisions", "id", row.decision_id);
  }
  return b;
}

function remap(value: unknown, mapping: Record<string, string>): unknown {
  if (typeof value === "string") return mapping[value] ?? value;
  if (Array.isArray(value)) return value.map((v) => remap(v, mapping));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, remap(v, mapping)]),
    );
  return value;
}
function mappedRows(bundle: DnaBundle, mapping: Record<string, string>) {
  const rows = structuredClone(bundle.rows);
  // Captured bytes, metadata and manifests are never rewritten to change identity.
  for (const table of [
    "enrichment_entity_evidence",
    "enrichment_founder_products",
    "enrichment_analysis_runs",
    "founder_dna_portrait_publications",
    "founder_dna_connection_decisions",
    "founder_dna_release_profiles",
  ] as Table[])
    rows[table] = rows[table].map((row) => remap(row, mapping) as Row);
  rows.enrichment_entities = rows.enrichment_entities.map((e) => ({
    ...e,
    id: mapping[String(e.id)],
  }));
  for (const p of rows.founder_dna_release_profiles)
    p.profile_hash = stableDigest(p.profile);
  return rows;
}
async function existing(tx: Sql, table: Table, row: Row) {
  return (
    await select(
      tx,
      table,
      keys[table].map((key, i) => `${key}=$${i + 1}`).join(" AND "),
      keys[table].map((key) => row[key]),
    )
  )[0];
}
function comparable(table: Table, row: Row) {
  const copy = { ...row };
  // Approval refresh time is local. Analysis creation times remain immutable:
  // they participate in the newer-publication guard.
  delete copy.updated_at;
  if (table === "enrichment_artifacts") {
    delete copy.attempt_id;
    delete copy.run_id;
    delete copy.import_batch;
  }
  return copy;
}
export async function dryRunDnaBundle(db: Sql, value: unknown) {
  const bundle = parseDnaBundle(value),
    mapping: Record<string, string> = {};
  const identityVerification: Record<
    string,
    "source_id_match" | "unverified_handle_match"
  > = {};
  for (const e of bundle.rows.enrichment_entities.filter(
    (e) => e.kind === "founder",
  )) {
    if (
      typeof e.legacy_key !== "string" ||
      !/^[A-Za-z0-9_]{1,15}$/.test(e.legacy_key)
    )
      throw new Error(`bundle_founder_identity_missing:${e.id}`);
    const matches = await select(
      db,
      "enrichment_entities",
      "id=$1 OR lower(legacy_key)=lower($2)",
      [e.id, e.legacy_key],
    );
    if (
      matches.length > 1 ||
      matches.some(
        (m) =>
          m.kind !== e.kind ||
          String(m.legacy_key).toLowerCase() !==
            String(e.legacy_key).toLowerCase(),
      )
    )
      throw new Error(`bundle_identity_conflict:${e.id}`);
    if (matches.some((m) => m.status !== "active"))
      throw new Error(`bundle_destination_suppressed:${e.id}`);
    if (matches[0]) {
      const incomingEvidence = new Set(
        bundle.rows.enrichment_entity_evidence
          .filter(
            (link) =>
              link.entity_id === e.id && link.relation !== "product_site",
          )
          .map((link) => link.evidence_id),
      );
      const incomingAuthors = new Set(
        bundle.rows.enrichment_evidence
          .filter(
            (row) =>
              incomingEvidence.has(row.id) &&
              typeof row.author_id === "string" &&
              row.author_id.trim(),
          )
          .map((row) => String(row.author_id).trim()),
      );
      const destinationAuthors = new Set(
        (
          await db.query<{ author_id: string }>(
            "SELECT DISTINCT e.author_id FROM enrichment_evidence e JOIN enrichment_entity_evidence l ON l.evidence_id=e.id WHERE l.entity_id=$1 AND l.relation<>'product_site' AND e.author_id IS NOT NULL AND trim(e.author_id)<>''",
            [matches[0].id],
          )
        ).rows.map((row) => row.author_id.trim()),
      );
      if (
        incomingAuthors.size &&
        destinationAuthors.size &&
        (incomingAuthors.size !== 1 ||
          destinationAuthors.size !== 1 ||
          !destinationAuthors.has([...incomingAuthors][0]))
      )
        throw new Error(`bundle_founder_source_identity_conflict:${e.id}`);
      identityVerification[String(e.id)] =
        incomingAuthors.size && destinationAuthors.size
          ? "source_id_match"
          : "unverified_handle_match";
    }
    mapping[String(e.id)] = String(matches[0]?.id ?? e.id);
  }
  for (const e of bundle.rows.enrichment_entities.filter(
    (e) => e.kind === "product",
  )) {
    const match = /^product:([0-9a-f-]{36}):(.+)$/.exec(String(e.legacy_key));
    if (!match || !mapping[match[1]])
      throw new Error(`bundle_product_identity_unresolved:${e.id}`);
    const legacyKey = `product:${mapping[match[1]]}:${match[2]}`;
    const matches = await select(
      db,
      "enrichment_entities",
      "id=$1 OR legacy_key=$2",
      [e.id, legacyKey],
    );
    if (
      matches.length > 1 ||
      matches.some((m) => m.kind !== "product" || m.legacy_key !== legacyKey)
    )
      throw new Error(`bundle_product_identity_conflict:${e.id}`);
    if (matches.some((m) => m.status !== "active"))
      throw new Error(`bundle_destination_suppressed:${e.id}`);
    mapping[String(e.id)] = String(matches[0]?.id ?? e.id);
  }
  const rows = mappedRows(bundle, mapping);
  for (const e of rows.enrichment_entities.filter((e) => e.kind === "product"))
    e.legacy_key = String(e.legacy_key).replace(
      /^product:([0-9a-f-]{36}):/,
      (_, id: string) => `product:${mapping[id] ?? id}:`,
    );
  const withdrawn = await db.query(
    "SELECT a.id FROM enrichment_artifacts a LEFT JOIN enrichment_artifact_withdrawals w ON w.artifact_id=a.id WHERE (a.id=ANY($1::uuid[]) OR a.sha256=ANY($2::text[])) AND (w.artifact_id IS NOT NULL OR a.purged_at IS NOT NULL)",
    [
      ids(rows.enrichment_artifacts),
      rows.enrichment_artifacts.map((a) => a.sha256),
    ],
  );
  if (withdrawn.rows.length)
    throw new Error("bundle_destination_artifact_withdrawn");
  for (const p of rows.founder_dna_release_profiles) {
    for (const [purpose, analysisId] of [
      ["founder_dna", p.analysis_id],
      ["founder_portrait", p.portrait_analysis_id],
    ]) {
      const incoming = rows.enrichment_analysis_runs.find(
        (a) => a.id === analysisId,
      );
      if (!incoming) throw new Error("bundle_analysis_dependency_missing");
      const newer = await db.query(
        `SELECT a.id FROM enrichment_analysis_runs a WHERE a.entity_id=$1 AND a.purpose=$3 AND a.id IN (
        SELECT analysis_id FROM enrichment_profiles WHERE entity_id=$1 UNION SELECT analysis_id FROM founder_dna_portrait_publications WHERE entity_id=$1 UNION SELECT p.analysis_id FROM founder_dna_release_profiles p JOIN founder_dna_active_release r ON r.release_id=p.release_id WHERE p.entity_id=$1 UNION SELECT p.portrait_analysis_id FROM founder_dna_release_profiles p JOIN founder_dna_active_release r ON r.release_id=p.release_id WHERE p.entity_id=$1
      ) AND (a.created_at > $2::timestamptz OR (a.created_at = $2::timestamptz AND a.id<>$4::uuid))`,
        [p.entity_id, incoming.created_at, purpose, incoming.id],
      );
      if (newer.rows.length)
        throw new Error(`bundle_newer_publication_exists:${p.entity_id}`);
    }
  }
  for (const table of tables) {
    for (const row of rows[table]) {
      const prior = await existing(db, table, row);
      if (!prior) continue;
      if (table === "enrichment_entities") continue;
      if (table === "founder_dna_portrait_publications") {
        // A newer portrait may replace an older approval; the timestamp guard above
        // rejects rollback. approvePortrait performs the same check atomically.
        continue;
      }
      if (
        stableDigest(comparable(table, prior)) !==
        stableDigest(comparable(table, row))
      )
        throw new Error(
          `bundle_row_conflict:${table}:${keys[table].map((k) => row[k]).join(":")}`,
        );
    }
  }
  const oldRelease = (
    await db.query<{
      manifest_hash: string;
      expected_profiles: number;
      schema_version: number;
      code_version: string;
    }>(
      "SELECT manifest_hash,expected_profiles,schema_version,code_version FROM founder_dna_releases WHERE id=$1",
      [bundle.manifest.release.id],
    )
  ).rows[0];
  if (
    oldRelease &&
    (oldRelease.manifest_hash !== bundle.manifest.release.manifest_hash ||
      oldRelease.expected_profiles !== bundle.manifest.cohort.length ||
      oldRelease.schema_version !== FOUNDER_DNA_SCHEMA_VERSION ||
      oldRelease.code_version !== DNA_CODE_VERSION)
  )
    throw new Error("bundle_release_identity_conflict");
  return {
    bundle,
    rows,
    mapping,
    identityVerification,
    summary: {
      releaseId: bundle.manifest.release.id,
      profiles: bundle.manifest.cohort.length,
      counts: bundle.manifest.counts,
      costs: bundle.manifest.costs,
      identityMappings: Object.entries(mapping).filter(([a, b]) => a !== b)
        .length,
      hash: bundle.hash,
      unverifiedIdentityMappings: Object.entries(identityVerification).filter(
        ([id, status]) =>
          mapping[id] !== id && status === "unverified_handle_match",
      ).length,
    },
  };
}
async function insert(tx: Sql, table: Table, row: Row) {
  const value =
    table === "enrichment_artifacts"
      ? {
          ...row,
          body: `\\x${Buffer.from(String(row.body), "base64").toString("hex")}`,
        }
      : row;
  await tx.query(
    `INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table},$1::jsonb) ON CONFLICT DO NOTHING`,
    [JSON.stringify(value)],
  );
}

/** One atomic stage transaction; cancellation leaves no partial import or pointer change. */
export async function stageDnaBundle(db: Database, value: unknown) {
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(73422002)");
    const plan = await dryRunDnaBundle(tx, value),
      { bundle, rows, mapping } = plan;
    const dna = new DnaPublicationStore({ ...tx, transaction: (fn) => fn(tx) });
    for (const row of rows.enrichment_entities)
      await insert(tx, "enrichment_entities", row);
    for (const row of rows.enrichment_artifacts)
      await insert(tx, "enrichment_artifacts", {
        ...row,
        attempt_id: null,
        run_id: null,
        import_batch: `dna-bundle:${bundle.hash}`,
      });
    const provenance = Buffer.from(
      JSON.stringify({
        bundleHash: bundle.hash,
        manifest: bundle.manifest,
        entityMapping: mapping,
        identityVerification: plan.identityVerification,
        artifactOrigins: bundle.rows.enrichment_artifacts.map(
          ({ id, attempt_id, run_id, import_batch }) => ({
            id,
            attempt_id,
            run_id,
            import_batch,
          }),
        ),
      }),
    );
    await insert(tx, "enrichment_artifacts", {
      id: stableUuid({ bundle: bundle.hash, mapping }),
      kind: "manifest",
      attempt_id: null,
      run_id: null,
      import_batch: `dna-bundle:${bundle.hash}`,
      sha256: createHash("sha256").update(provenance).digest("hex"),
      body: provenance.toString("base64"),
      byte_length: provenance.length,
      content_type: "application/json",
      redaction_version: "private-import-provenance-v1",
      metadata: { private: true },
      created_at: bundle.manifest.release.created_at,
      expires_at: null,
      purged_at: null,
    });
    for (const table of [
      "enrichment_evidence",
      "enrichment_entity_evidence",
      "enrichment_founder_products",
      "enrichment_releases",
      "enrichment_analysis_runs",
    ] as Table[])
      for (const row of rows[table]) await insert(tx, table, row);
    await dna.createRelease({
      id: String(bundle.manifest.release.id),
      manifest: bundle.manifest.release.manifest,
      expectedProfiles: bundle.manifest.cohort.length,
    });
    for (const row of rows.founder_dna_portrait_publications)
      await dna.approvePortrait(
        String(row.entity_id),
        String(row.analysis_id),
        String(row.approved_by),
      );
    for (const row of rows.founder_dna_release_profiles) {
      if (!(await existing(tx, "founder_dna_release_profiles", row)))
        await dna.stageProfile({
          releaseId: String(row.release_id),
          entityId: String(row.entity_id),
          analysisId: String(row.analysis_id),
          portraitAnalysisId: String(row.portrait_analysis_id),
        });
    }
    for (const row of rows.founder_dna_connection_decisions)
      await insert(tx, "founder_dna_connection_decisions", row);
    for (const row of rows.founder_dna_release_edges)
      if (!(await existing(tx, "founder_dna_release_edges", row)))
        await dna.stageConnection(
          String(row.release_id),
          String(row.decision_id),
        );
    return plan.summary;
  });
}
