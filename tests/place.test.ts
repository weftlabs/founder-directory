import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanPlace, normalizePlaces } from "../lib/place";
import { noKey, offline, placesResponse, response } from "./fixtures";

const empty = { city: null, country: null };
const paris = { raw: "Paris", city: "Paris", country: "France" };

test("no key fails closed without constructing a client; strict calls reject", async () => {
  assert.deepEqual(
    [...(await normalizePlaces(["Paris", "Paris", "", "  "], {}, noKey))],
    [["Paris", empty]],
  );
  await assert.rejects(
    normalizePlaces(["Paris"], { strict: true }, noKey),
    /missing API key/,
  );
});

test("local overrides need no key, are isolated, and never use inherited properties", async () => {
  const result = await normalizePlaces(
    ["  VERONA ", "San Francisco Bay Area", "constructor", "__proto__"],
    {},
    noKey,
  );
  assert.deepEqual(result.get("  VERONA "), {
    city: "Verona",
    country: "Italy",
  });
  assert.deepEqual(result.get("San Francisco Bay Area"), {
    city: "San Francisco",
    country: "United States",
  });
  assert.deepEqual(result.get("constructor"), empty);
  assert.deepEqual(result.get("__proto__"), empty);
  result.get("  VERONA ")!.city = "changed";
  assert.equal(
    (await normalizePlaces(["Verona"], { strict: true }, noKey)).get("Verona")
      ?.city,
    "Verona",
  );
  assert.equal((await normalizePlaces([], { strict: true }, noKey)).size, 0);
});

test("place request keeps its cap/routing; recovery preserves raw keys and null non-places", async () => {
  let calls = 0;
  const dependencies = offline(async (request) => {
    calls++;
    assert.equal(request.maxCostUsd, "0.002");
    assert.equal(request.operationId, "openrouter-chat-completions");
    assert.equal(request.accessMethodId, "mpp-access-23-0-0");
    const body = JSON.parse(request.body as string);
    assert.deepEqual(JSON.parse(body.messages[1].content), [
      " Paris ",
      "building cool stuff",
    ]);
    return calls === 1
      ? response(502)
      : placesResponse([paris, { raw: "building cool stuff", ...empty }]);
  });
  const places = await normalizePlaces(
    [" Paris ", "building cool stuff"],
    { strict: true },
    dependencies,
  );
  assert.equal(calls, 2);
  assert.deepEqual(
    [...places],
    [
      [" Paris ", { city: "Paris", country: "France" }],
      ["building cool stuff", empty],
    ],
  );
});

test("case and whitespace variants share one mapping without losing raw keys", async () => {
  const raws = ["Paris", "paris", " Paris ", "New York", "new  york"];
  for (const strict of [false, true]) {
    const result = await normalizePlaces(
      raws,
      { strict },
      offline(async (request) => {
        const body = JSON.parse(request.body as string);
        const requested = JSON.parse(body.messages[1].content) as string[];
        assert.deepEqual(requested, ["Paris", "New York"]);
        return placesResponse(
          requested.map((raw) => ({
            raw,
            city: raw,
            country: raw === "Paris" ? "France" : "United States",
          })),
        );
      }),
    );
    for (const raw of raws) {
      assert.deepEqual(
        result.get(raw),
        raw.toLowerCase().includes("paris")
          ? { city: "Paris", country: "France" }
          : { city: "New York", country: "United States" },
      );
    }
  }
});

test("strict rejects malformed, incomplete, duplicate and unsolicited mappings", async () => {
  for (const rows of [
    [],
    {},
    null,
    [null],
    [{ raw: "Paris" }],
    [{ ...paris, city: 7 }],
    [{ ...paris, country: [] }],
    [{ ...paris, city: " " }],
    [paris, paris],
    [paris, { raw: "London", city: "London", country: "United Kingdom" }],
  ]) {
    await assert.rejects(
      normalizePlaces(
        ["Paris"],
        { strict: true },
        offline(async () => placesResponse(rows)),
      ),
      /incomplete|malformed/,
    );
  }
  for (const rows of [
    [{ raw: "Paris" }],
    [{ ...paris, country: false }],
    [paris, { ...paris, city: "Other" }],
  ]) {
    assert.deepEqual(
      (
        await normalizePlaces(
          ["Paris"],
          {},
          offline(async () => placesResponse(rows)),
        )
      ).get("Paris"),
      empty,
    );
  }
});

test("invalid JSON, invalid envelopes, prose, and unavailable responses fail closed", async () => {
  const fixtures = [
    response(403),
    {
      ...response(200),
      bodyBase64: Buffer.from("not json").toString("base64"),
    },
    response(200, null),
    response(200, []),
    response(200, { choices: [{ message: { content: 1 } }] }),
    response(200, {
      choices: [{ message: { content: `prose ${JSON.stringify([paris])}` } }],
    }),
  ];
  for (const fixture of fixtures) {
    const deps = offline(async () => fixture);
    assert.deepEqual(
      (await normalizePlaces(["Paris"], {}, deps)).get("Paris"),
      empty,
    );
    await assert.rejects(
      normalizePlaces(["Paris"], { strict: true }, deps),
      /Place normalization/,
    );
  }
});

test("observed geography mistakes are rejected or canonicalized", () => {
  assert.deepEqual(cleanPlace({ city: null, country: "Europe" }), empty);
  assert.deepEqual(
    cleanPlace({ city: "New Jersey", country: "United States of America" }),
    { city: null, country: "United States" },
  );
  assert.deepEqual(cleanPlace({ city: null, country: "The Bahamas" }), {
    city: null,
    country: "Bahamas",
  });
});
