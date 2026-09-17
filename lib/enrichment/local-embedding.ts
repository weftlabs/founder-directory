// Layer: adapter. Owns pinned offline inference and durable zero-cost capture.
import "../assert-server";
import { isAbsolute } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { collectResponse, type CollectionStore } from "./collection";
import type { WorkerDependencies } from "./worker";

const MODEL = "sentence-transformers/all-MiniLM-L6-v2";
const REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41";
const MODEL_DIGEST =
  "6fd5d72fe4589f189f8ebc006442dbb529bb7ce38f8082112682524616046452";
const VOCABULARY_DIGEST =
  "be50c3628f2bf5bb5e3a7f17b1f74611b2561a3a27eeab05e5aa30f411572037";
export const LOCAL_EMBEDDING_OPERATION = "local-minilm-inference";
const scriptPath = () =>
  fileURLToPath(new URL("../../scripts/local-embedding.py", import.meta.url));
export function localEmbeddingConfiguration() {
  return {
    model: MODEL,
    modelVersion: `${REVISION}:onnx-fp32:mean-l2:256:ort1.27.0:numpy2.5.1:tokenizers0.22.2:script-${createHash("sha256").update(readFileSync(scriptPath())).digest("hex")}`,
    dimensions: 384,
  };
}
export function validateLocalEmbeddingConfiguration(
  value:
    { model: string; modelVersion: string; dimensions: number } | undefined,
) {
  const expected = localEmbeddingConfiguration();
  if (
    !value ||
    value.model !== expected.model ||
    value.modelVersion !== expected.modelVersion ||
    value.dimensions !== expected.dimensions
  )
    throw new Error("local_embedding_configuration_mismatch");
}
export function localEmbeddingAdapter(
  store: CollectionStore,
  config: {
    scope: string;
    budgetId: string;
    enabled?: () => boolean;
    pythonExecutable: string;
    modelDirectory: string;
    policy: import("./collection").CollectionInput["policy"];
  },
): NonNullable<WorkerDependencies["embed"]> {
  if (
    !isAbsolute(config.pythonExecutable) ||
    !isAbsolute(config.modelDirectory)
  )
    throw new Error("local_embedding_paths_must_be_absolute");
  return async (input) => {
    if (
      input.model !== MODEL ||
      input.modelVersion !== localEmbeddingConfiguration().modelVersion ||
      input.dimensions !== 384
    )
      throw new Error("local_embedding_configuration_mismatch");
    const script = scriptPath();
    const executableDigest = createHash("sha256")
      .update(await readFile(script))
      .digest("hex");
    const artifact = await collectResponse(
      store,
      {
        scope: config.scope,
        budgetId: config.budgetId,
        generation: input.generation,
        operation: "local-minilm-inference",
        mode: "acquire",
        capMicros: "0",
        args: {
          execution: "local",
          model: MODEL,
          revision: REVISION,
          modelDigest: MODEL_DIGEST,
          vocabularyDigest: VOCABULARY_DIGEST,
          executableDigest,
          modelVersion: input.modelVersion,
          dimensions: 384,
          pooling: "attention-mask-mean-l2",
          maxWordPieces: 256,
          text: input.text,
          templateVersion: input.templateVersion,
        },
        policy: config.policy,
      },
      async () => {
        const body = await new Promise<Buffer>((resolve, reject) => {
          const child = spawn(
            config.pythonExecutable,
            ["-I", script, config.modelDirectory],
            {
              stdio: ["pipe", "pipe", "pipe"],
              env: {
                PATH: "/usr/bin:/bin",
                NODE_ENV: "production",
                HF_HUB_OFFLINE: "1",
                TOKENIZERS_PARALLELISM: "false",
              },
            },
          );
          const chunks: Buffer[] = [];
          let size = 0;
          let timedOut = false;
          const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, 30000);
          child.stdout.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > 1048576) child.kill("SIGKILL");
            else chunks.push(chunk);
          });
          child.stderr.resume();
          child.on("error", () => {
            clearTimeout(timer);
            reject(new Error("local_embedding_process_failed"));
          });
          child.stdin.on("error", () => {});
          child.on("close", (code) => {
            clearTimeout(timer);
            if (timedOut || code !== 0 || size > 1048576)
              reject(new Error("local_embedding_process_failed"));
            else resolve(Buffer.concat(chunks));
          });
          child.stdin.end(JSON.stringify({ text: input.text }));
        });
        return {
          body,
          status: 200,
          contentType: "application/json",
          paymentStatus: "not_required",
          paidUsd: "0",
          heldUsd: "0",
        };
      },
      {
        enabled: config.enabled ?? (() => true),
        redactionVersion: "local-embedding-no-credentials-v1",
      },
    );
    // The complete output above is durable before parsing or vector validation.
    let output;
    try {
      output = JSON.parse(Buffer.from(artifact.body).toString("utf8"));
    } catch {
      throw new Error("local_embedding_invalid_response");
    }
    if (!output || typeof output !== "object")
      throw new Error("local_embedding_invalid_response");
    if (
      output.execution !== "local" ||
      output.model !== MODEL ||
      output.revision !== REVISION ||
      output.modelDigest !== MODEL_DIGEST ||
      output.vocabularyDigest !== VOCABULARY_DIGEST ||
      output.dimensions !== 384 ||
      output.pooling !== "attention-mask-mean-l2" ||
      output.maxWordPieces !== 256 ||
      output.runtime?.onnxruntime !== "1.27.0" ||
      output.runtime?.numpy !== "2.5.1" ||
      output.runtime?.tokenizers !== "0.22.2" ||
      !Array.isArray(output.vector) ||
      output.vector.length !== 384 ||
      !output.vector.every(
        (value: unknown) => typeof value === "number" && Number.isFinite(value),
      )
    )
      throw new Error("local_embedding_invalid_response");
    const attemptId = artifact.metadata.attemptId;
    if (typeof attemptId !== "string" || !attemptId)
      throw new Error("local_embedding_missing_attempt");
    return {
      vector: output.vector,
      attemptId,
      responseArtifactId: artifact.id,
    };
  };
}
