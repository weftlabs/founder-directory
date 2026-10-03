// Accounted LLM judge: answers the same choice questions as Jev through a chat model.
import "../assert-server";
import type { CollectionInput } from "./collection";
import { canonicalJson, stableDigest } from "./contracts";
import type { EnrichmentStore } from "./store";
import type { WeftTransport } from "../weft";
import type { ProviderResponse, Request } from "../typesafe-poc";
import type { ExecuteRetainedDecision } from "./retained-jev";
import { collectWeft } from "./weft-transport";
import { generationRoute } from "./generation";
import { generationContent } from "./analysis";
import { deepseekFlashParameters } from "./recipes";

export const LLM_JUDGE_VERSION = "llm-choice-judge-v1";
const SYSTEM = [
  "You are a strict evidence judge. The user message holds `state` (JSON with rules,",
  "evidence and the statements to check) and `questions`. For every question, read its",
  "instructions and pick exactly one criteria key. Judge only from the evidence in state;",
  "never use outside knowledge. When evidence does not clearly establish a statement,",
  "do not choose the supporting option. Give a probability for every criteria key of that",
  "question; probabilities sum to 1 and the chosen key has the highest probability.",
].join(" ");

/** Parse and normalize a chat answer into the Jev response shape. Fails closed. */
export function parseJudgeAnswers(
  content: string,
  request: Request,
): ProviderResponse["answers"] {
  const parsed: unknown = JSON.parse(content);
  const answers =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as { answers?: unknown }).answers
      : null;
  if (!answers || typeof answers !== "object" || Array.isArray(answers))
    throw new Error("llm_judge_invalid_answers");
  const keys = Object.keys(request.questions);
  if (
    Object.keys(answers).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(answers, key))
  )
    throw new Error("llm_judge_question_mismatch");
  const out: ProviderResponse["answers"] = {};
  for (const key of keys) {
    const answer = (answers as Record<string, unknown>)[key] as {
      choice?: unknown;
      probabilities?: Record<string, unknown>;
    };
    const criteria = Object.keys(request.questions[key].criteria);
    const raw = answer?.probabilities ?? {};
    if (
      typeof answer?.choice !== "string" ||
      !criteria.includes(answer.choice) ||
      Object.keys(raw).length !== criteria.length ||
      !criteria.every(
        (c) =>
          typeof raw[c] === "number" &&
          Number.isFinite(raw[c]) &&
          (raw[c] as number) >= 0,
      )
    )
      throw new Error("llm_judge_invalid_choice");
    const total = criteria.reduce((sum, c) => sum + (raw[c] as number), 0);
    if (total <= 0) throw new Error("llm_judge_invalid_choice");
    const probabilities = Object.fromEntries(
      criteria.map((c) => [c, (raw[c] as number) / total]),
    );
    const chosen = probabilities[answer.choice];
    if (chosen < Math.max(...Object.values(probabilities)))
      throw new Error("llm_judge_inconsistent");
    out[key] = {
      type: "choice",
      choice: answer.choice,
      confidence: chosen,
      probabilities,
    };
  }
  return out;
}

function responseSchema(request: Request) {
  const properties = Object.fromEntries(
    Object.entries(request.questions).map(([key, question]) => {
      const criteria = Object.keys(question.criteria);
      return [
        key,
        {
          type: "object",
          additionalProperties: false,
          required: ["choice", "probabilities"],
          properties: {
            choice: { type: "string", enum: criteria },
            probabilities: {
              type: "object",
              additionalProperties: false,
              required: criteria,
              properties: Object.fromEntries(
                criteria.map((c) => [c, { type: "number" }]),
              ),
            },
          },
        },
      ];
    }),
  );
  return {
    type: "object",
    additionalProperties: false,
    required: ["answers"],
    properties: {
      answers: {
        type: "object",
        additionalProperties: false,
        required: Object.keys(properties),
        properties,
      },
    },
  };
}

export function llmJudge(
  store: EnrichmentStore,
  client: WeftTransport,
  config: {
    scope: string;
    budgetId: string;
    maxCostUsd: string;
    policy: CollectionInput["policy"];
    enabled: () => boolean;
    model: { provider: string; model: string; revision: string | null };
  },
): ExecuteRetainedDecision {
  const route = generationRoute(config.model.provider);
  return async (input) => {
    if (!input.recipeVersion || !input.evidenceIds.length)
      throw new Error("invalid_jev_request");
    const requestArtifact = await store.putArtifact({
      kind: "generation_request",
      body: Buffer.from(canonicalJson(input.request)),
      contentType: "application/json",
      redactionVersion: "credential-free-request-v1",
      runId: input.runId,
      metadata: {
        judge: LLM_JUDGE_VERSION,
        model: config.model.model,
        recipeVersion: input.recipeVersion,
        evidenceIds: input.evidenceIds,
      },
    });
    const body = {
      ...deepseekFlashParameters(config.model),
      temperature: 0,
      max_tokens: 400 + 150 * Object.keys(input.request.questions).length,
      model: config.model.revision ?? config.model.model,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: canonicalJson({
            state: JSON.parse(input.request.state),
            questions: input.request.questions,
          }),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "judge",
          strict: true,
          schema: responseSchema(input.request),
        },
      },
    };
    const raw = await collectWeft(
      store,
      client,
      {
        scope: config.scope,
        budgetId: config.budgetId,
        generation: 0,
        operation: route.operationId,
        policy: config.policy,
        mode: "acquire",
        requestIdentity: `${LLM_JUDGE_VERSION}:${input.runId}:${stableDigest(input.request)}`,
      },
      {
        ...route,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: canonicalJson(body),
        maxCostUsd: config.maxCostUsd,
      },
      config.enabled,
    );
    const status = raw.metadata.status;
    if (typeof status !== "number" || status < 200 || status >= 300)
      throw new Error("jev_http_response_archived");
    const envelope = Buffer.from(raw.body).toString("utf8");
    const usage = (() => {
      try {
        return JSON.parse(envelope).usage ?? {};
      } catch {
        return {};
      }
    })();
    const response: ProviderResponse = {
      model: `${LLM_JUDGE_VERSION}:${config.model.model}`,
      answers: parseJudgeAnswers(generationContent(envelope), input.request),
      usage: {
        input_tokens: Number(usage.prompt_tokens) || 0,
        output_tokens: Number(usage.completion_tokens) || 0,
      },
    };
    // The normalized decision is retained beside the raw provider envelope it came from.
    const decision = await store.putArtifact({
      kind: "manifest",
      body: Buffer.from(canonicalJson(response)),
      contentType: "application/json",
      redactionVersion: "credential-free-bundle-v1",
      runId: input.runId,
      metadata: {
        purpose: "llm_judge_decision",
        requestArtifactId: requestArtifact.id,
        rawResponseArtifactId: raw.id,
        recipeVersion: input.recipeVersion,
        evidenceIds: input.evidenceIds,
      },
    });
    if (typeof raw.metadata.attemptId !== "string")
      throw new Error("jev_request_capture_missing");
    const paid = Number(raw.metadata.paidUsd ?? 0) || 0;
    return {
      response,
      requestArtifactId: requestArtifact.id,
      responseArtifactId: decision.id,
      attemptId: raw.metadata.attemptId,
      estimatedCostMicros: String(Math.ceil(paid * 1_000_000)),
    };
  };
}
