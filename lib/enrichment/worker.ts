// Layer: orchestration. Owns fixed evidence-to-profile stages; all paid I/O is injected and accounted.
import {
  canonicalJson,
  stableDigest,
  type EvidenceInput,
  type JsonValue,
} from "./contracts";
import { runAnalysis, type ExecuteGeneration } from "./analysis";
import {
  buildAnalysisInput,
  DEFAULT_STAGES,
  RECIPE_VERSION,
  selectAnalysisEvidence,
} from "./recipes";
import {
  STAGES,
  type ClaimedStage,
  type Stage,
  type StageOutcome,
} from "./pipeline";
import type { EnrichmentStore } from "./store";
import type { WorkerStore } from "./worker-store";
import { parseWebsiteArtifact, publicWebsiteUrl } from "./website";

const SOURCE_BUNDLE_VERSION = "profile-website-bundle-v1";
const EXTRACTION_VERSION = "profile-website-evidence-v1";
type WebsiteCoverage = {
  provider?: "exa" | "jina";
  status: "captured" | "unavailable" | "disabled";
  reason?: string;
  artifactId?: string;
  url?: string;
};
type SourceBundle = {
  version: typeof SOURCE_BUNDLE_VERSION;
  profileArtifactId: string;
  website: WebsiteCoverage;
};

export interface WorkerConfiguration {
  codeDigest: string;
  model: { provider: string; model: string; revision: string | null };
  embedding?: { model: string; modelVersion: string; dimensions: number };
  website?: { provider: "exa" | "jina"; maxExcerptChars?: number };
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
  collectWebsite?: (input: {
    provider?: "exa" | "jina";
    entityId: string;
    generation: number;
    websiteUrl: string;
    sourceProfileArtifactId: string;
    maxExcerptChars?: number;
  }) => Promise<
    | { status: "captured"; artifactId: string }
    | { status: "unavailable"; reason: string; artifactId?: string }
  >;
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
    sourceBundleVersion: SOURCE_BUNDLE_VERSION,
    extractionVersion: EXTRACTION_VERSION,
    website: configuration.website ?? null,
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
  async function extraction(work: ClaimedStage) {
    const id = await workerStore.stageOutput(work, "extraction");
    const artifact = id ? await store.getArtifact(id) : null;
    if (!artifact || artifact.kind !== "manifest")
      throw new Error("missing_input");
    const body = JSON.parse(Buffer.from(artifact.body).toString("utf8"));
    if (
      body.version !== EXTRACTION_VERSION ||
      !Array.isArray(body.evidenceIds) ||
      !Array.isArray(body.artifactIds)
    )
      throw new Error("invalid_extraction_manifest");
    for (const id of body.artifactIds)
      if (!(await store.getArtifact(id)))
        throw new Error("missing_saved_source");
    return body as {
      evidenceIds: string[];
      artifactIds: string[];
      website: WebsiteCoverage;
    };
  }
  async function evidence(work: ClaimedStage): Promise<EvidenceInput[]> {
    const selected = await extraction(work);
    const result = await workerStore.evidenceByIds(
      work.entityId,
      selected.evidenceIds,
    );
    if (!result.length || result.length !== selected.evidenceIds.length)
      throw new Error("missing_input");
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
        const savedArtifact = saved ? await store.getArtifact(saved) : null;
        if (savedArtifact?.kind === "manifest") {
          const bundle = JSON.parse(
            Buffer.from(savedArtifact.body).toString("utf8"),
          ) as SourceBundle;
          if (
            bundle.version === SOURCE_BUNDLE_VERSION &&
            (await store.getArtifact(bundle.profileArtifactId)) &&
            (!bundle.website.artifactId ||
              (await store.getArtifact(bundle.website.artifactId)))
          ) {
            return { status: "succeeded", outputId: saved! };
          }
        }
        if (dependencies.mode === "rederive" && !savedArtifact)
          return { status: "blocked", reason: "missing_saved_source" };
        if (savedArtifact && savedArtifact.kind !== "source_response")
          return { status: "blocked", reason: "missing_saved_source" };
        if (!savedArtifact && !dependencies.collectProfile)
          return { status: "blocked", reason: "collection_not_configured" };
        const entity = await workerStore.entity(work.entityId);
        await store.assertStageLease(work.id, work.leaseToken);
        const result = savedArtifact
          ? { status: "captured" as const, artifactId: savedArtifact.id }
          : await dependencies.collectProfile!({
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
        const profile = extractProfile(artifact.body);
        if (
          profile.status === "available" &&
          (!entity.legacyKey ||
            String(profile.payload.handle).toLowerCase() !==
              entity.legacyKey.toLowerCase())
        )
          return {
            status: "blocked",
            reason: "source_identity_mismatch",
            outputId: artifact.id,
          };
        let website: WebsiteCoverage = { status: "disabled" };
        if (dependencies.website && profile.status === "available") {
          const url =
            typeof profile.payload.website === "string"
              ? publicWebsiteUrl(profile.payload.website)
              : null;
          if (!url)
            website = {
              status: "unavailable",
              reason: "missing_public_profile_website",
            };
          else if (dependencies.mode === "rederive")
            website = {
              status: "unavailable",
              reason: "missing_saved_website",
              url,
            };
          else if (!dependencies.collectWebsite)
            website = {
              status: "unavailable",
              reason: "website_collection_not_configured",
              url,
            };
          else {
            await store.assertStageLease(work.id, work.leaseToken);
            const collected = await dependencies.collectWebsite({
              provider: dependencies.website.provider,
              entityId: work.entityId,
              generation: work.generation,
              websiteUrl: url,
              sourceProfileArtifactId: artifact.id,
              maxExcerptChars: dependencies.website.maxExcerptChars,
            });
            if (collected.artifactId) {
              const retained = await store.getArtifact(collected.artifactId);
              if (
                !retained ||
                retained.kind !== "source_response" ||
                retained.metadata.sourceKind !== "product-site"
              )
                throw new Error("website_capture_missing");
            }
            website = {
              ...collected,
              url,
              provider: dependencies.website.provider,
            };
          }
        }
        const bundle = await store.putArtifact({
          kind: "manifest",
          runId: work.id,
          body: Buffer.from(
            canonicalJson({
              version: SOURCE_BUNDLE_VERSION,
              profileArtifactId: artifact.id,
              website,
            }),
          ),
          contentType: "application/json",
          redactionVersion: "credential-free-bundle-v1",
          metadata: {
            purpose: "worker_source_bundle",
            entityId: work.entityId,
            generation: work.generation,
          },
        });
        return { status: "succeeded", outputId: bundle.id };
      },
      async extraction(work) {
        const bundleId = await workerStore.stageOutput(work, "collection");
        const bundleArtifact = bundleId
          ? await store.getArtifact(bundleId)
          : null;
        if (!bundleArtifact || bundleArtifact.kind !== "manifest")
          throw new Error("missing_source_bundle");
        const bundle = JSON.parse(
          Buffer.from(bundleArtifact.body).toString("utf8"),
        ) as SourceBundle;
        if (bundle.version !== SOURCE_BUNDLE_VERSION)
          throw new Error("invalid_source_bundle");
        const artifact = await store.getArtifact(bundle.profileArtifactId);
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
        const evidenceIds = [id],
          artifactIds = [artifact.id];
        let website = bundle.website;
        if (dependencies.website && website.status === "disabled")
          website = { status: "unavailable", reason: "missing_saved_website" };
        if (
          dependencies.website &&
          website.url &&
          (typeof result.payload.website !== "string" ||
            publicWebsiteUrl(result.payload.website) !== website.url)
        )
          throw new Error("website_profile_binding_mismatch");
        if (dependencies.website && website.artifactId && website.url) {
          const raw = await store.getArtifact(website.artifactId);
          if (
            !raw ||
            raw.kind !== "source_response" ||
            raw.metadata.sourceKind !== "product-site" ||
            raw.metadata.requestedUrl !== website.url
          )
            throw new Error("missing_saved_website");
          artifactIds.push(raw.id);
          const parsed = parseWebsiteArtifact(raw, {
            provider: website.provider ?? "exa",
            websiteUrl: website.url,
            sourceProfileArtifactId: artifact.id,
            maxExcerptChars: dependencies.website.maxExcerptChars,
          });
          if (parsed.status === "captured") {
            const websiteId = await store.addEvidence({
              artifactId: raw.id,
              extractorVersion: `${parsed.provenance.extractorVersion}:chars:${dependencies.website.maxExcerptChars ?? 24000}`,
              locator: `results:${parsed.provenance.requestedUrl}`,
              sourceUrl: parsed.provenance.returnedUrl,
              // The source bundle binds this founder to the URL. Raw capture
              // metadata keeps its original profile even when shared URL bytes
              // are reused by another founder. Do not rewrite that history.
              payload: {
                sourceKind: parsed.provenance.sourceKind,
                requestedUrl: parsed.provenance.requestedUrl,
                returnedUrl: parsed.provenance.returnedUrl,
                publishedDate: parsed.provenance.publishedDate,
                crawlDate: parsed.provenance.crawlDate,
                originalChars: parsed.provenance.originalChars,
                truncated: parsed.provenance.truncated,
              },
              excerpt: parsed.text,
            });
            await store.linkEvidence(work.entityId, websiteId, "product_site");
            evidenceIds.push(websiteId);
            website = { ...website, status: "captured" };
          } else
            website = {
              ...website,
              status: "unavailable",
              reason: parsed.reason,
            };
        }
        const extracted = await store.putArtifact({
          kind: "manifest",
          runId: work.id,
          body: Buffer.from(
            canonicalJson({
              version: EXTRACTION_VERSION,
              evidenceIds,
              artifactIds,
              website,
            }),
          ),
          contentType: "application/json",
          redactionVersion: "credential-free-bundle-v1",
          metadata: {
            purpose: "worker_extraction",
            entityId: work.entityId,
            generation: work.generation,
            sourceBundleId: bundleArtifact.id,
          },
        });
        return { status: "succeeded", evidenceId: id, outputId: extracted.id };
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
        const coverage = (await extraction(work)).website;
        if (dependencies.website && coverage.status !== "captured")
          return {
            status: "unavailable",
            reason: coverage.reason ?? "website_unavailable",
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
        const selected = selectAnalysisEvidence(
          "founder_dna",
          await evidence(work),
        );
        if (!selected.length)
          return { status: "unavailable", reason: "no_personal_evidence" };
        const result = await analyze(work, "founder_dna", selected);
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
