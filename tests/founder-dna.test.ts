import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { Pool } from "pg";
import { parseFounderDnaProfile } from "../lib/founder-dna";
import { founderDnaFixture } from "./fixtures/founder-dna";
import { loadFounderDnaProfile } from "../lib/founder-dna-data";
test("public DNA projection is bounded, strips private fields and permits no product", () => {
  const profile = parseFounderDnaProfile({
    ...founderDnaFixture(),
    secret: "PRIVATE",
    vectors: [1],
  });
  assert.equal(profile.products.length, 0);
  assert.equal(JSON.stringify(profile).includes("PRIVATE"), false);
  assert.throws(() =>
    parseFounderDnaProfile({ ...profile, connections: Array(4).fill({}) }),
  );
  assert.throws(() =>
    parseFounderDnaProfile({
      ...profile,
      sources: [
        {
          id: "source",
          label: "Source",
          kind: "bio",
          url: "javascript:bad",
          excerpt: "Text",
        },
      ],
    }),
  );
});
test("disabled reader does not access database and enabled missing DB is unavailable", async () => {
  const db = {
    query: async () => {
      throw new Error("must not query");
    },
  };
  assert.deepEqual(await loadFounderDnaProfile("example", {}, db), {
    status: "disabled",
  });
  assert.deepEqual(
    await loadFounderDnaProfile("example", { FOUNDER_DNA_ENABLED: "1" }),
    { status: "unavailable" },
  );
});

test("runtime DNA clients require the shared database before any provider request", async () => {
  const previousFetch = globalThis.fetch;
  let httpRequests = 0;
  let postgresRequests = 0;
  const profile = founderDnaFixture();
  globalThis.fetch = async () => {
    httpRequests++;
    return Response.json({
      fields: [
        { name: "status", dataTypeID: 25 },
        { name: "profile", dataTypeID: 114 },
      ],
      rows: [["ready", JSON.stringify(profile)]],
      rowCount: 1,
      command: "SELECT",
    });
  };
  const query = mock.method(Pool.prototype, "query", async () => {
    postgresRequests++;
    return { rows: [{ status: "ready", profile }] };
  });
  const env = {
    FOUNDER_DNA_ENABLED: "1",
    DATABASE_URL: "postgres://directory:synthetic@db.example.test/founders",
    FOUNDER_DNA_DATABASE_URL:
      "postgres://dna:synthetic@db.example.test/founders",
  };
  try {
    for (const transport of ["neon", "postgres"]) {
      for (const config of [
        { ...env, DATABASE_URL: undefined },
        { ...env, FOUNDER_DNA_DATABASE_URL: undefined },
        {
          ...env,
          FOUNDER_DNA_DATABASE_URL:
            "postgres://dna:synthetic@other.example.test/founders",
        },
      ]) {
        assert.deepEqual(
          await loadFounderDnaProfile("example", {
            ...config,
            FOUNDER_DNA_DATABASE_TRANSPORT: transport,
          }),
          { status: "unavailable" },
        );
      }
    }
    assert.equal(httpRequests, 0);
    assert.equal(postgresRequests, 0);
    for (const transport of ["neon", "postgres"]) {
      const result = await loadFounderDnaProfile("example", {
        ...env,
        FOUNDER_DNA_DATABASE_TRANSPORT: transport,
      });
      assert.deepEqual(result, { status: "ready", profile });
    }
    assert.equal(httpRequests, 1);
    assert.equal(postgresRequests, 1);
  } finally {
    globalThis.fetch = previousFetch;
    query.mock.restore();
  }
});

test("explicit SQL injection remains available without runtime URLs", async () => {
  const profile = founderDnaFixture();
  const result = await loadFounderDnaProfile(
    "example",
    { FOUNDER_DNA_ENABLED: "1" },
    {
      async query<T>() {
        return { rows: [{ status: "ready", profile }] as T[] };
      },
    },
  );
  assert.deepEqual(result, { status: "ready", profile });
});
