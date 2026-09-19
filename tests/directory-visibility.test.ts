import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  foundationReadEnabled,
  readDirectoryPage,
  readFounder,
  readFounders,
} from "../lib/db";
import { DIRECTORY_PAGE_SIZE } from "../lib/directory-page";

const filters = { q: "", category: "", country: "", city: "" };

async function fixture() {
  const pg = new PGlite();
  await pg.exec(
    await readFile(
      new URL("../migrations/001_enrichment.sql", import.meta.url),
      "utf8",
    ),
  );
  await pg.exec(`CREATE TABLE founders (
    handle text PRIMARY KEY, name text, bio text, website text, github text,
    linkedin text, city text, country text, location text, avatar_url text,
    category text, vibe_label text, vibe_score integer,
    vibe_signals jsonb DEFAULT '[]', intro_text text, intro_url text,
    updated_at timestamptz DEFAULT '2026-09-01T12:00:00Z'
  )`);
  async function seed(
    handle: string,
    hidden = false,
    country = "Switzerland",
    city = "Zurich",
    category = "AI",
  ) {
    await pg.query(
      `INSERT INTO founders(handle,name,city,country,category,vibe_label,vibe_score,intro_text)
      VALUES($1,$1,$2,$3,$4,'Builder',50,'Legacy intro')`,
      [handle, city, country, category],
    );
    if (hidden)
      await pg.query(
        `INSERT INTO enrichment_entities(id,kind,legacy_key,status)
      VALUES($1,'founder',$2,'suppressed')`,
        [randomUUID(), handle.toLowerCase()],
      );
  }
  return { pg, seed };
}

test("foundation visibility is required for either origin reads or DNA activation", () => {
  assert.equal(foundationReadEnabled({}), false);
  assert.equal(foundationReadEnabled({ ENRICHMENT_READ_ORIGINS: "1" }), true);
  assert.equal(foundationReadEnabled({ FOUNDER_DNA_ENABLED: "1" }), true);
  assert.equal(
    foundationReadEnabled({
      ENRICHMENT_READ_ORIGINS: "0",
      FOUNDER_DNA_ENABLED: "1",
    }),
    true,
  );
});

test("suppression precedes directory pagination, total, facets and map reads", async () => {
  const { pg, seed } = await fixture();
  try {
    for (let i = 0; i < DIRECTORY_PAGE_SIZE + 2; i++)
      await seed(`visible_${String(i).padStart(2, "0")}`);
    await seed(
      "ZZ_hidden",
      true,
      "Hidden country",
      "Hidden city",
      "Hidden category",
    );
    await seed(
      "ZZ_hidden2",
      true,
      "Other country",
      "Zurich",
      "Hidden category",
    );
    // A suppressed product with a matching legacy key must not suppress a founder.
    await pg.query(
      `INSERT INTO enrichment_entities(id,kind,legacy_key,status) VALUES($1,'product','visible_00','suppressed')`,
      [randomUUID()],
    );
    const first = await readDirectoryPage(pg, filters, true);
    assert.equal(first.total, 50);
    assert.equal(first.founders.length, DIRECTORY_PAGE_SIZE);
    assert.deepEqual(first.categories, ["AI"]);
    assert.deepEqual(first.countries, [
      { value: "Switzerland", label: "Switzerland", count: 50 },
    ]);
    assert.deepEqual(first.cities, [
      {
        value: "Zurich",
        country: "Switzerland",
        label: "Zurich, Switzerland",
        count: 50,
      },
    ]);
    assert.ok(first.nextCursor);
    const second = await readDirectoryPage(
      pg,
      { ...filters, cursor: first.nextCursor },
      true,
    );
    assert.equal(second.founders.length, 2);
    assert.equal(second.nextCursor, null);
    assert.equal(
      new Set([...first.founders, ...second.founders].map((f) => f.handle))
        .size,
      50,
    );
    assert.equal((await readFounders(pg, true)).length, 50);
    assert.equal(await readFounder(pg, "zz_HIDDEN", true), null);
    assert.equal(
      (await readDirectoryPage(pg, { ...filters, q: "ZZ_hidden" }, true)).total,
      0,
    );
    assert.equal(
      (await readDirectoryPage(pg, { ...filters, city: "Zurich" }, true)).total,
      50,
    );
    assert.equal(
      (await readFounder(pg, "visible_00", true))?.introText,
      "Legacy intro",
    );
    await seed("another_country", false, "France", "Lyon");
    const cityPage = await readDirectoryPage(
      pg,
      { ...filters, city: "Zurich" },
      true,
    );
    assert.deepEqual(
      cityPage.cities.map((city) => city.value),
      ["Zurich"],
    );
  } finally {
    await pg.close();
  }
});

test("disabled fixture mode needs no enrichment tables; enabled reads fail closed", async () => {
  const { pg, seed } = await fixture();
  try {
    await seed("unimported");
    await pg.exec("DROP TABLE enrichment_entities CASCADE");
    assert.equal((await readDirectoryPage(pg, filters, false)).total, 1);
    assert.equal((await readFounders(pg, false)).length, 1);
    assert.equal(
      (await readFounder(pg, "unimported", false))?.handle,
      "unimported",
    );
    await assert.rejects(
      readDirectoryPage(pg, filters, true),
      /enrichment_entities/,
    );
    await assert.rejects(readFounders(pg, true), /enrichment_entities/);
    await assert.rejects(
      readFounder(pg, "unimported", true),
      /enrichment_entities/,
    );
  } finally {
    await pg.close();
  }
});

test("expired and purged indexing sources cannot revive the legacy profile intro", async () => {
  const { pg, seed } = await fixture();
  try {
    for (const state of ["expired", "purged"] as const) {
      await seed(state);
      const [entity, artifact, evidence] = Array.from({ length: 3 }, () =>
        randomUUID(),
      );
      await pg.query(
        "INSERT INTO enrichment_entities(id,kind,legacy_key,status) VALUES($1,'founder',$2,'active')",
        [entity, state],
      );
      await pg.query(
        `INSERT INTO enrichment_artifacts(id,kind,import_batch,sha256,body,byte_length,content_type,redaction_version,metadata,expires_at,purged_at)
        VALUES($1,'source_response','synthetic','hash',CASE WHEN $3 THEN ''::bytea ELSE 'x'::bytea END,CASE WHEN $3 THEN 0 ELSE 1 END,'text/plain','none','{}',CASE WHEN $2 THEN now()-interval '1 day' ELSE NULL END,CASE WHEN $3 THEN now() ELSE NULL END)`,
        [artifact, state === "expired", state === "purged"],
      );
      await pg.query(
        `INSERT INTO enrichment_evidence(id,artifact_id,extractor_version,locator,payload,excerpt,source_url)
        VALUES($1,$2,'test','$','{}','Original intro','https://x.com/synthetic/status/123')`,
        [evidence, artifact],
      );
      await pg.query(
        "INSERT INTO enrichment_index_origins(founder_id,evidence_id,status) VALUES($1,$2,'confirmed')",
        [entity, evidence],
      );
      const founder = await readFounder(pg, state, true);
      assert.ok(founder);
      assert.equal(founder.introText, null);
      assert.equal(founder.introUrl, null);
    }
  } finally {
    await pg.close();
  }
});
