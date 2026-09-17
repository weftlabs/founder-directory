// Layer: orchestration. Owns fixed evidence-to-profile stages; all paid I/O is injected and accounted.
import {
  canonicalJson,
  stableDigest,
  type EvidenceInput,
  type JsonValue,
} from "./contracts";
import { runAnalysis, type ExecuteGeneration } from "./analysis";
import { buildAnalysisInput, DEFAULT_STAGES, RECIPE_VERSION } from "./recipes";
import {
  STAGES,
  type ClaimedStage,
  type Stage,
  type StageOutcome,
} from "./pipeline";
import type { EnrichmentStore } from "./store";
import type { WorkerStore } from "./worker-store";

export interface WorkerConfiguration {
  codeDigest: string;
  model: { provider: string; model: string; revision: string | null };
  embedding?: { model: string; modelVersion: string; dimensions: number };
}
export interface WorkerDependencies extends WorkerConfiguration {
  mode: "acquire" | "rederive";
  collectProfile?: (input: {
    entityId: string;
    legacyKey: string | null;
    generation: number;
  }) => Promise<
    | { status: "captured"; artifactId: string }
    | { status: "unavailable" | "blocked"; reason: string; artifactId?: string }
  >;
  executeGeneration: ExecuteGeneration;
  embed?: (input: {
    entityId: string;
    analysisId: string;
    generation: number;
    text: string;
    templateVersion: string;
    model: string;
    modelVersion: string;
    dimensions: number;
  }) => Promise<{
    vector: number[];
    attemptId: string;
    responseArtifactId: string;
  }>;
}

export function buildWorkerManifest(configuration: WorkerConfiguration) {
  const worker = {
    codeDigest: configuration.codeDigest,
    model: configuration.model,
    embedding: configuration.embedding ?? null,
    recipeVersion: RECIPE_VERSION,
    extractorVersion: "atlas-profile-v1",
  };
  const recipes = Object.fromEntries(
    (["product_discovery", "product_descriptions", "founder_dna"] as const).map(
      (purpose) => [
        purpose,
        stableDigest(
          buildAnalysisInput({
            entityId: "manifest",
            releaseId: "manifest",
            generation: 0,
            purpose,
            evidence: [],
            model: configuration.model,
            codeDigest: configuration.codeDigest,
          }).recipe,
        ),
      ],
    ),
  );
  const dependencies = Object.fromEntries(
    DEFAULT_STAGES.map((stage) => [stage.id, [...stage.dependencies]]),
  );
  return { stages: [...STAGES], dependencies, worker, recipes };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
interface Claim {
  field: string;
  value: JsonValue;
  state: string;
  evidenceIds: string[];
}
function claims(output: unknown): Claim[] {
  if (!record(output) || !Array.isArray(output.claims))
    throw new Error("validated_output_missing");
  return output.claims as Claim[];
}
interface Product {
  name: string;
  website: string | null;
  evidenceIds: string[];
}

function canonicalProductUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.href;
  } catch {
    return null;
  }
}

/** Preserve ownership citations and all saved excerpts from the exact product page. */
export function selectProductEvidence(
  product: Pick<Product, "website" | "evidenceIds">,
  evidence: EvidenceInput[],
): EvidenceInput[] {
  const cited = new Set(product.evidenceIds);
  const website = canonicalProductUrl(product.website);
  return evidence.filter(
    (row) =>
      cited.has(row.id) ||
      (website !== null && canonicalProductUrl(row.sourceUrl) === website),
  );
}

/** Parses the enabled Atlas profile contract only. Unknown contracts fail visibly. */
export function extractProfile(body: Uint8Array):
  | {
      status: "available";
      payload: Record<string, JsonValue>;
      sourceUrl: string;
    }
  | { status: "unavailable"; reason: string } {
  const raw: unknown = JSON.parse(Buffer.from(body).toString("utf8"));
  if (!record(raw) || !record(raw.data))
    throw new Error("profile_schema_invalid");
  const data = raw.data;
  if (record(data.privacy) && data.privacy.protected === true)
    return { status: "unavailable", reason: "protected_account" };
  const core = record(data.core) ? data.core : null;
  const name = text(core?.name),
    handle = text(core?.screen_name);
  if (!name || !handle || !/^\w{1,50}$/.test(handle))
    throw new Error("profile_identity_missing");
  const bio = record(data.profile_bio)
    ? text(data.profile_bio.description)
    : null;
  const website = record(data.website) ? text(data.website.url) : null;
  const location = record(data.location) ? text(data.location.location) : null;
  return {
    status: "available",
    payload: { name, handle, bio, website, location },
    sourceUrl: `https://x.com/${handle}`,
  };
}

export function createStageHandlers(
  store: EnrichmentStore,
  workerStore: WorkerStore,
  dependencies: WorkerDependencies,
): Record<Stage, (work: ClaimedStage) => Promise<StageOutcome>> {
  const manifest = buildWorkerManifest(dependencies);
  async function evidence(work: ClaimedStage): Promise<EvidenceInput[]> {
    const artifactId = await workerStore.stageOutput(work, "extraction");
    if (!artifactId) throw new Error("missing_input");
    const result = await workerStore.evidence(work.entityId, artifactId);
    if (!result.length) throw new Error("missing_input");
    return result;
  }
  async function analyze(
    work: ClaimedStage,
    purpose: "product_discovery" | "product_descriptions" | "founder_dna",
    selected: EvidenceInput[],
    subjectName?: string,
  ) {
    const input = buildAnalysisInput({
      entityId: work.entityId,
      releaseId: work.releaseId,
      generation: work.generation,
      purpose,
      evidence: selected,
      model: dependencies.model,
      codeDigest: dependencies.codeDigest,
      ...(subjectName ? { subjectName } : {}),
    });
    return runAnalysis(store, input, async (request) => {
      await store.assertStageLease(work.id, work.leaseToken);
      return dependencies.executeGeneration(request);
    });
  }
  async function discoveredProducts(
    work: ClaimedStage,
  ): Promise<{ id: string; name: string; evidenceIds: string[] }[] | null> {
    const discovery = await workerStore.analysis(work, "product_discovery");
    if (!discovery) throw new Error("product_discovery_missing");
    const found = claims(discovery.output).find(
      (claim) => claim.field === "products",
    );
    if (
      !found ||
      found.state === "unknown" ||
      found.state === "conflict" ||
      found.state === "stale"
    )
      return null;
    if (found.state === "absent") return [];
    const products = found.value as unknown as Product[];
    if (!Array.isArray(products) || products.length > 8)
      throw new Error("products_invalid");
    const selected = await evidence(work);
    const result = [];
    for (const product of products) {
      const evidenceIds = selectProductEvidence(product, selected).map(
        (row) => row.id,
      );
      const id = await workerStore.ensureProduct(
        work,
        product.name,
        evidenceIds,
      );
      result.push({ id, name: product.name, evidenceIds });
    }
    return result;
  }
  const handlers: Record<Stage, (work: ClaimedStage) => Promise<StageOutcome>> =
    {
      async collection(work) {
        const saved = await workerStore.stageOutput(work, "collection", true);
        if (saved && (await store.getArtifact(saved)))
          return { status: "succeeded", outputId: saved };
        if (dependencies.mode === "rederive")
          return { status: "blocked", reason: "missing_saved_source" };
        if (!dependencies.collectProfile)
          return { status: "blocked", reason: "collection_not_configured" };
        const entity = await workerStore.entity(work.entityId);
        await store.assertStageLease(work.id, work.leaseToken);
        const result = await dependencies.collectProfile({
          entityId: work.entityId,
          legacyKey: entity.legacyKey,
          generation: work.generation,
        });
        if (result.artifactId) {
          const retained = await store.getArtifact(result.artifactId);
          if (!retained || retained.kind !== "source_response")
            throw new Error("source_capture_missing");
        }
        if (result.status !== "captured")
          return {
            status: result.status,
            reason: result.reason,
            ...(result.artifactId ? { outputId: result.artifactId } : {}),
          };
        const artifact = await store.getArtifact(result.artifactId);
        if (!artifact || artifact.kind !== "source_response")
          throw new Error("source_capture_missing");
        return { status: "succeeded", outputId: artifact.id };
      },
      async extraction(work) {
        const artifactId = await workerStore.stageOutput(work, "collection");
        const artifact = artifactId
          ? await store.getArtifact(artifactId)
          : null;
        if (!artifact) throw new Error("missing_saved_source");
        const result = extractProfile(artifact.body);
        if (result.status === "unavailable")
          return {
            status: "unavailable",
            reason: result.reason,
            outputId: artifact.id,
          };
        const entity = await workerStore.entity(work.entityId);
        if (
          !entity.legacyKey ||
          String(result.payload.handle).toLowerCase() !==
            entity.legacyKey.toLowerCase()
        )
          return {
            status: "blocked",
            reason: "source_identity_mismatch",
            outputId: artifact.id,
          };
        const id = await store.addEvidence({
          artifactId: artifact.id,
          extractorVersion: "atlas-profile-v1",
          locator: "data.profile",
          sourceUrl: result.sourceUrl,
          payload: result.payload,
          excerpt: canonicalJson(result.payload),
        });
        await store.linkEvidence(work.entityId, id, "profile_source");
        return { status: "succeeded", evidenceId: id, outputId: artifact.id };
      },
      async product_discovery(work) {
        const selected = await evidence(work),
          result = await analyze(work, "product_discovery", selected);
        if (result.status === "failed" || result.status === "missing_input")
          return {
            status: "failed",
            reason: "product_discovery_invalid",
            outputId: result.runId,
          };
        const products = await discoveredProducts(work);
        if (products === null)
          return {
            status: "unavailable",
            reason: "product_ownership_unknown",
            outputId: result.runId,
          };
        // Absence is a successful discovery result; the description step records evidence-backed N/A.
        return {
          status: "succeeded",
          evidenceId: selected[0].id,
          outputId: result.runId,
        };
      },
      async product_descriptions(work) {
        const products = await discoveredProducts(work),
          selected = await evidence(work);
        if (products === null)
          return { status: "unavailable", reason: "product_ownership_unknown" };
        if (!products.length)
          return {
            status: "not_applicable",
            reason: "source_reports_no_product",
            evidenceId: selected[0].id,
          };
        let outputId: string | undefined;
        for (const product of products) {
          const related = selected.filter((row) =>
            product.evidenceIds.includes(row.id),
          );
          const result = await analyze(
            { ...work, entityId: product.id },
            "product_descriptions",
            related,
            product.name,
          );
          outputId = result.runId;
          if (result.status === "failed" || result.status === "missing_input")
            return {
              status: "failed",
              reason: "product_description_invalid",
              outputId,
            };
          if (!(await store.publishAnalysis(result.runId)))
            return {
              status: "blocked",
              reason: "product_publication_stale",
              outputId,
            };
        }
        return { status: "succeeded", outputId };
      },
      async founder_dna(work) {
        const result = await analyze(work, "founder_dna", await evidence(work));
        if (result.status === "failed" || result.status === "missing_input")
          return {
            status: "failed",
            reason: "founder_dna_invalid",
            outputId: result.runId,
          };
        if (!(await store.publishAnalysis(result.runId)))
          return {
            status: "blocked",
            reason: "founder_publication_stale",
            outputId: result.runId,
          };
        return { status: "succeeded", outputId: result.runId };
      },
      async embeddings(work) {
        if (!dependencies.embedding || !dependencies.embed)
          return { status: "blocked", reason: "embeddings_not_configured" };
        const products = await discoveredProducts(work);
        if (products === null)
          return { status: "unavailable", reason: "product_ownership_unknown" };
        const subjects = [
          { id: work.entityId, purpose: "founder_dna" },
          ...products.map((product) => ({
            id: product.id,
            purpose: "product_descriptions",
          })),
        ];
        let outputId: string | undefined;
        for (const subject of subjects) {
          const analysis = await workerStore.analysis(
            { ...work, entityId: subject.id },
            subject.purpose,
          );
          if (!analysis) throw new Error("embedding_analysis_missing");
          const fields =
            subject.purpose === "founder_dna"
              ? ["summary", "craft", "working_style", "interests"]
              : [
                  "description",
                  "audience",
                  "problem",
                  "product_type",
                  "domain",
                ];
          const savedClaims = claims(analysis.output);
          if (
            !savedClaims.some(
              (claim) =>
                claim.field === fields[0] &&
                claim.state === "supported" &&
                typeof claim.value === "string",
            )
          )
            return {
              status: "unavailable",
              reason: "embedding_description_unknown",
            };
          const inputText = fields
            .map((field) =>
              savedClaims.find(
                (claim) => claim.field === field && claim.state === "supported",
              ),
            )
            .filter((claim): claim is Claim => !!claim)
            .map((claim) => `${claim.field}: ${claim.value}`)
            .join("\n");
          const templateVersion = `${subject.purpose}-search-v1`,
            scope = await workerStore.scope(subject.id);
          let embeddingId = await workerStore.embedding(
            scope,
            inputText,
            dependencies.embedding,
            templateVersion,
          );
          if (!embeddingId) {
            await store.assertStageLease(work.id, work.leaseToken);
            const generated = await dependencies.embed({
              entityId: subject.id,
              analysisId: analysis.id,
              generation: work.generation,
              text: inputText,
              templateVersion,
              ...dependencies.embedding,
            });
            if (
              !generated.attemptId ||
              !generated.responseArtifactId ||
              !(await store.getArtifact(generated.responseArtifactId)) ||
              generated.vector.length !== dependencies.embedding.dimensions
            )
              throw new Error("embedding_capture_invalid");
            embeddingId = await store.saveEmbedding({
              scope,
              text: inputText,
              templateVersion,
              ...dependencies.embedding,
              distance: "cosine",
              vector: generated.vector,
              attemptId: generated.attemptId,
            });
          }
          await store.linkEmbedding(
            subject.id,
            analysis.id,
            embeddingId,
            subject.purpose,
          );
          outputId = embeddingId;
        }
        return { status: "succeeded", outputId };
      },
    };
  return Object.fromEntries(
    STAGES.map((stage) => [
      stage,
      async (work: ClaimedStage) => {
        await workerStore.assertConfiguration(work, manifest.worker);
        return handlers[stage](work);
      },
    ]),
  ) as typeof handlers;
}
