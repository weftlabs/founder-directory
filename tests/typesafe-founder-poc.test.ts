import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  parseFounderInput,
  buildFounderRequest,
  runFounderPoc,
  renderFounderReport,
} from "../lib/typesafe-founder-poc";
import { MODEL, validateResponse } from "../lib/typesafe-poc";
const fixture = {
  version: 1,
  kind: "founder",
  founders: [
    {
      id: "founder",
      name: "Example",
      evidence: [
        {
          id: "bio",
          ownerId: "founder",
          sourceKind: "self-reported",
          sourceUrl: "https://example.com/profile",
          text: "Former researcher. CEO of a scheduling tool. Documenting my journey in public.",
        },
      ],
      expectedFacets: {
        venture_domain: {
          expected: "productivity",
          referenceNote: "HIDDEN_DOMAIN",
        },
        craft: { expected: "unknown", referenceNote: "HIDDEN_CRAFT" },
        building_style: {
          expected: "publicly_documenting",
          referenceNote: "HIDDEN_STYLE",
        },
        founding_role: { expected: "unknown", referenceNote: "HIDDEN_ROLE" },
      },
      claims: [
        {
          id: "research",
          text: "Example is currently a researcher.",
          expected: "unsupported",
          referenceNote: "HIDDEN_CLAIM",
        },
      ],
    },
  ],
};
const founder = () => parseFounderInput(fixture).founders[0];
function response() {
  const request = buildFounderRequest(founder());
  return {
    model: MODEL,
    answers: Object.fromEntries(
      Object.entries(request.questions).map(([key, q]) => {
        const choice = key.startsWith("claim_") ? "unsupported" : "unknown";
        return [
          key,
          {
            type: "choice",
            choice,
            confidence: 0.3,
            probabilities: Object.fromEntries(
              Object.keys(q.criteria).map((k) => [k, Number(k === choice)]),
            ),
          },
        ];
      }),
    ),
    usage: { input_tokens: 100, output_tokens: 0 },
  };
}
test("founder evidence excludes product websites and other owners", () => {
  for (const evidence of [
    { ...fixture.founders[0].evidence[0], sourceKind: "product-site" },
    { ...fixture.founders[0].evidence[0], ownerId: "someone-else" },
  ])
    assert.throws(() =>
      parseFounderInput({
        ...fixture,
        founders: [{ ...fixture.founders[0], evidence: [evidence] }],
      }),
    );
  assert.throws(() =>
    parseFounderInput({
      ...fixture,
      founders: Array(4).fill(fixture.founders[0]),
    }),
  );
});
test("founder questions exclude references and preserve current/former and personal boundaries", () => {
  const request = buildFounderRequest(founder());
  assert.doesNotMatch(
    JSON.stringify(request),
    /HIDDEN_|referenceNote|expected/,
  );
  for (const key of [
    "venture_domain",
    "craft",
    "building_style",
    "founding_role",
  ])
    assert.ok(request.questions[key].criteria.unknown);
  assert.match(request.questions.craft.instructions, /former|historical/i);
  assert.match(request.questions.craft.instructions, /CEO/);
  assert.match(request.questions.founding_role.instructions, /alone/i);
  assert.match(request.questions.claim_0.instructions, /interest/i);
  assert.match(
    request.questions.claim_0.instructions,
    /currently a researcher/,
  );
  assert.deepEqual(
    JSON.parse(request.state).evidence.map((e: { id: string }) => e.id),
    ["bio"],
  );
  validateResponse(response(), request);
});
test("founder dry run is offline and bounded, live uses strict common response validation", async () => {
  let calls = 0;
  const data = parseFounderInput(fixture);
  const fetcher = async () => {
    calls++;
    return new Response(JSON.stringify(response()));
  };
  const dry = await runFounderPoc(data, { live: false, fetcher });
  assert.equal(calls, 0);
  assert.equal(dry.summary.facetTotal, 0);
  await assert.rejects(
    () => runFounderPoc(data, { live: true, fetcher }),
    /missing_key/,
  );
  const live = await runFounderPoc(data, {
    live: true,
    apiKey: "synthetic-key",
    fetcher,
  });
  assert.equal(calls, 1);
  assert.equal(live.summary.facetTotal, 4);
  assert.equal(live.summary.claimMatches, 1);
  assert.throws(() =>
    buildFounderRequest({
      ...founder(),
      evidence: [{ ...founder().evidence[0], text: "x".repeat(40000) }],
    }),
  );
});
test("founder failure records checkpoint and stops the next call", async () => {
  let calls = 0;
  const statuses: string[] = [];
  const data = parseFounderInput({
    ...fixture,
    founders: [
      fixture.founders[0],
      {
        ...fixture.founders[0],
        id: "second",
        evidence: [{ ...fixture.founders[0].evidence[0], ownerId: "second" }],
      },
    ],
  });
  const run = await runFounderPoc(data, {
    live: true,
    apiKey: "synthetic-key",
    fetcher: async () => {
      calls++;
      throw new Error("secret-error");
    },
    checkpoint: async (r) => {
      statuses.push(r.founders[0].status);
    },
  });
  assert.equal(calls, 1);
  assert.equal(run.status, "failed");
  assert.equal(run.founders[1].status, "pending");
  assert.ok(statuses.includes("in_flight"));
  assert.ok(statuses.includes("failed"));
  assert.doesNotMatch(JSON.stringify(run), /secret-error|synthetic-key/);
});
test("founder report escapes source attribution and does not invent citations", async () => {
  const data = parseFounderInput(fixture);
  data.founders[0].evidence[0].text = "<script>private source</script>";
  const html = renderFounderReport(await runFounderPoc(data, { live: false }));
  assert.match(html, /Evidence considered/);
  assert.match(html, /not exact citations/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("CLI dispatches founder input offline and refuses product-site evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "typesafe-founder-test-"));
  try {
    await mkdir(join(root, ".local"));
    const input = join(root, ".local/input.json");
    await writeFile(input, JSON.stringify(fixture));
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
    const run = spawnSync(process.execPath, args, {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    const saved = JSON.parse(
      await readFile(join(root, ".local/result.json"), "utf8"),
    );
    assert.equal(saved.schema, "typesafe-founder-poc-result-v1");
    assert.equal(saved.summary.callsAttempted, 0);
    assert.match(
      await readFile(join(root, ".local/result.html"), "utf8"),
      /Founder categories/,
    );
    const invalid = structuredClone(fixture);
    invalid.founders[0].evidence[0].sourceKind = "product-site";
    await writeFile(input, JSON.stringify(invalid));
    const rejected = spawnSync(
      process.execPath,
      [...args.slice(0, -1), ".local/rejected.json", "--live"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(rejected.status, 1);
    await assert.rejects(() => readFile(join(root, ".local/rejected.json")), {
      code: "ENOENT",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
