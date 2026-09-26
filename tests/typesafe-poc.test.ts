import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  stat,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildRequest,
  parseInput,
  validateResponse,
  callTypesafe,
  runPoc,
  renderReport,
  MODEL,
  ENDPOINT,
} from "../lib/typesafe-poc";

const input = {
  version: 1,
  products: [
    {
      id: "sample",
      name: "Example",
      sourceUrl: "https://example.com",
      sourceText: "Example is an API for developers.",
      expectedCategory: "developer",
      categoryReference: "HIDDEN CATEGORY NOTE",
      claims: [
        {
          id: "api",
          text: "Example offers an API.",
          expected: "supported",
          referenceNote: "HIDDEN CLAIM NOTE",
        },
      ],
    },
  ],
};
const product = () => parseInput(input).products[0];
const request = () => buildRequest(product());
function response() {
  const questions = request().questions;
  return {
    model: MODEL,
    answers: Object.fromEntries(
      Object.entries(questions).map(([id, q]) => {
        const choice = id === "category" ? "developer" : "supported";
        return [
          id,
          {
            type: "choice",
            choice,
            confidence: 1,
            probabilities: Object.fromEntries(
              Object.keys(q.criteria).map((key) => [
                key,
                Number(key === choice),
              ]),
            ),
          },
        ];
      }),
    ),
    usage: { input_tokens: 100, output_tokens: 0 },
  };
}

test("request hides reference labels and puts each claim in visible instructions", () => {
  const body = JSON.stringify(request());
  assert.doesNotMatch(body, /HIDDEN|expected|referenceNote|sourceUrl/);
  assert.match(
    request().questions.claim_0.instructions,
    /Example offers an API/,
  );
  assert.equal(Object.keys(request().questions.category.criteria).length, 11);
  assert.throws(() =>
    parseInput({ ...input, products: Array(4).fill(input.products[0]) }),
  );
  assert.throws(() =>
    buildRequest({ ...product(), sourceText: "x".repeat(40000) }),
  );
});

test("malformed distributions, model and missing answers fail closed", () => {
  validateResponse(response(), request());
  const lowConfidence = response();
  lowConfidence.answers.category.confidence = 0.1;
  validateResponse(lowConfidence, request());
  const variants = [
    (r: ReturnType<typeof response>) => {
      delete r.answers.claim_0;
    },
    (r: ReturnType<typeof response>) => {
      r.answers.category.confidence = -0.1;
    },
    (r: ReturnType<typeof response>) => {
      r.answers.category.probabilities.health = NaN;
    },
    (r: ReturnType<typeof response>) => {
      r.answers.category.probabilities.health = 1;
    },
    (r: ReturnType<typeof response>) => {
      r.answers.category.probabilities.extra = 0;
    },
    (r: ReturnType<typeof response>) => {
      r.answers.category.choice = "health";
    },
    (r: ReturnType<typeof response>) => {
      r.model = "wrong";
    },
  ];
  for (const change of variants) {
    const r = response();
    change(r);
    assert.throws(() => validateResponse(r, request()));
  }
  const wrongNumber = JSON.parse(JSON.stringify(response()));
  wrongNumber.answers.category.confidence = "1";
  assert.throws(() => validateResponse(wrongNumber, request()));
});

test("dry run needs no key and never calls network; live requires key", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return new Response(JSON.stringify(response()));
  };
  const dry = await runPoc(parseInput(input), { live: false, fetcher });
  assert.equal(calls, 0);
  assert.equal(dry.status, "complete");
  await assert.rejects(
    () => runPoc(parseInput(input), { live: true, fetcher }),
    /missing_key/,
  );
  assert.equal(calls, 0);
});

test("live boundary fixes endpoint, disables redirects and sends one request", async () => {
  let calls = 0;
  const result = await callTypesafe(
    request(),
    "synthetic-key",
    async (url, options) => {
      calls++;
      assert.equal(url, ENDPOINT);
      assert.equal(options?.redirect, "error");
      assert.ok(options?.signal);
      assert.equal(
        new Headers(options?.headers).get("Authorization"),
        "Bearer synthetic-key",
      );
      return new Response(JSON.stringify(response()));
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.response.model, MODEL);
});

test("failure is checkpointed, redacted and stops later paid calls", async () => {
  let calls = 0;
  const statuses: string[] = [];
  const two = parseInput({
    ...input,
    products: [input.products[0], { ...input.products[0], id: "two" }],
  });
  const result = await runPoc(two, {
    live: true,
    apiKey: "synthetic-key",
    fetcher: async () => {
      calls++;
      throw new Error("SECRET PROVIDER ERROR");
    },
    checkpoint: async (r) => {
      statuses.push(r.products[0].status);
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "failed");
  assert.equal(result.products[0].error, "transport_error");
  assert.equal(result.products[1].status, "pending");
  assert.ok(statuses.includes("in_flight"));
  assert.ok(statuses.includes("failed"));
  assert.doesNotMatch(
    JSON.stringify(result),
    /SECRET PROVIDER ERROR|synthetic-key/,
  );
});

test("HTTP errors, invalid JSON and oversized bodies never retry", async () => {
  for (const [body, status] of [
    ["private error", 401],
    ["not json", 200],
    ["x".repeat(1_000_001), 200],
  ] as const) {
    let calls = 0;
    await assert.rejects(() =>
      callTypesafe(request(), "synthetic-key", async () => {
        calls++;
        return new Response(body, { status });
      }),
    );
    assert.equal(calls, 1);
  }
});

test("report escapes data and omits the source dump", async () => {
  const run = await runPoc(
    parseInput({
      ...input,
      products: [{ ...input.products[0], name: "<script>alert(1)</script>" }],
    }),
    { live: false },
  );
  const html = renderReport(run);
  assert.doesNotMatch(html, /<script>|Example is an API for developers/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /source support/i);
});

test("CLI defaults to private offline output and refuses an existing run", async () => {
  const root = await mkdtemp(join(tmpdir(), "typesafe-poc-test-"));
  try {
    await mkdir(join(root, ".local"));
    await writeFile(join(root, ".local/input.json"), JSON.stringify(input));
    const args = [
      "--import",
      resolve("node_modules/tsx/dist/loader.mjs"),
      "--import",
      resolve("tests/no-network.mjs"),
      resolve("scripts/typesafe-poc.ts"),
      "--input",
      ".local/input.json",
      "--output",
      ".local/result.json",
    ];
    const first = spawnSync(process.execPath, args, {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(first.status, 0, first.stderr);
    const output = await readFile(join(root, ".local/result.json"), "utf8");
    assert.equal(JSON.parse(output).summary.callsAttempted, 0);
    assert.equal(
      (await stat(join(root, ".local/result.json"))).mode & 0o777,
      0o600,
    );
    assert.equal(
      (await stat(join(root, ".local/result.html"))).mode & 0o777,
      0o600,
    );
    const repeat = spawnSync(process.execPath, [...args, "--live"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(repeat.status, 1);
    assert.equal(
      await readFile(join(root, ".local/result.json"), "utf8"),
      output,
    );
    const missingKey = spawnSync(
      process.execPath,
      [...args.slice(0, -1), ".local/missing-key.json", "--live"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(missingKey.status, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
