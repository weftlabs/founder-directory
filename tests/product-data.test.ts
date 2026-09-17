import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { loadProducts, readProductPage } from "../lib/product-data";
import { productCard, productPage, productQuery } from "../lib/products";
const claim = (
  field: string,
  value: string | null,
  kind = "self_report",
  state = value === null ? "unknown" : "supported",
) => ({ field, value, kind, state, evidenceIds: [] });
async function fixture() {
  const pg = new PGlite();
  await pg.exec(
    await readFile(
      new URL("../migrations/001_enrichment.sql", import.meta.url),
      "utf8",
    ),
  );
  async function seed(name: string, change = "", domain = "Healthcare") {
    const [
      product,
      founder,
      raw,
      manifest,
      evidence,
      release,
      analysis,
      relraw,
      relev,
    ] = Array.from({ length: 9 }, () => randomUUID());
    await pg.query(
      "INSERT INTO enrichment_entities(id,kind,legacy_key,status) VALUES($1,'product',NULL,$3),($2,'founder',$4,$5)",
      [
        product,
        founder,
        change === "suppressed-product" ? "suppressed" : "active",
        `f${founder.slice(0, 8)}`,
        change === "suppressed-founder" ? "suppressed" : "active",
      ],
    );
    for (const [id, expired, kind] of [
      [raw, change === "expired-source", "source_response"],
      [manifest, change === "expired-manifest", "manifest"],
      [relraw, change === "expired-relationship", "source_response"],
    ] as const) {
      await pg.query(
        "INSERT INTO enrichment_artifacts(id,kind,import_batch,sha256,body,byte_length,content_type,redaction_version,metadata,expires_at) VALUES($1,$2,'synthetic','hash','x',1,'text/plain','none','{}',CASE WHEN $3 THEN now()-interval '1 day' ELSE NULL END)",
        [id, kind, expired],
      );
    }
    for (const [id, artifact] of [
      [evidence, raw],
      [relev, relraw],
    ])
      await pg.query(
        "INSERT INTO enrichment_evidence(id,artifact_id,extractor_version,locator,payload,excerpt,source_url) VALUES($1,$2,'test','$','{\"sourceKind\":\"product-site\"}','Synthetic','https://example.test')",
        [id, artifact],
      );
    await pg.query(
      "INSERT INTO enrichment_entity_evidence(entity_id,evidence_id,relation) VALUES($1,$2,'source'),($3,$4,'ownership')",
      [product, evidence, founder, relev],
    );
    await pg.query(
      "INSERT INTO enrichment_founder_products(founder_id,product_id,evidence_id) VALUES($1,$2,$3)",
      [founder, product, relev],
    );
    await pg.query(
      "INSERT INTO enrichment_releases(id,manifest,status,evaluation_artifact_id,approval) VALUES($1,'{}',$2,$3,'{}')",
      [
        release,
        change === "retired-release"
          ? "retired"
          : change === "unapproved-release"
            ? "proposed"
            : "approved",
        manifest,
      ],
    );
    const claims = [
      claim("name", name),
      claim("description", "A saved product for doctors"),
      claim("domain", domain),
      claim("product_type", "application"),
      claim("audience", "Doctors"),
      claim("business_model", null),
      claim("stage", "Beta", "inference"),
    ];
    await pg.query(
      "INSERT INTO enrichment_analysis_runs(id,entity_id,release_id,generation,purpose,input_artifact_id,input_digest,recipe_digest,evidence_ids,output,validation_report,status) VALUES($1,$2,$3,0,$4,$5,'input','recipe',$6,$7,'{}',$8)",
      [
        analysis,
        product,
        release,
        change === "wrong-purpose" ? "founder_dna" : "product_descriptions",
        manifest,
        JSON.stringify([evidence]),
        JSON.stringify({ claims }),
        change === "failed" ? "failed" : "succeeded",
      ],
    );
    if (change !== "unpublished")
      await pg.query(
        "INSERT INTO enrichment_profiles(entity_id,analysis_id) VALUES($1,$2)",
        [product, analysis],
      );
    if (change.startsWith("withdraw-"))
      await pg.query(
        "INSERT INTO enrichment_artifact_withdrawals(artifact_id,reason,actor) VALUES($1,'synthetic','test')",
        [
          change === "withdraw-source"
            ? raw
            : change === "withdraw-manifest"
              ? manifest
              : relraw,
        ],
      );
    if (change === "purged-evidence" || change === "purged-relationship")
      await pg.query(
        "UPDATE enrichment_evidence SET purged_at=now(),payload='{}',excerpt='',source_id=NULL,source_url=NULL,author_id=NULL,published_at=NULL WHERE id=$1",
        [change === "purged-evidence" ? evidence : relev],
      );
    if (change === "purged-source")
      await pg.query(
        "UPDATE enrichment_artifacts SET purged_at=now(),body='',byte_length=0,metadata='{}' WHERE id=$1",
        [raw],
      );
    if (change === "purged-analysis")
      await pg.query(
        "UPDATE enrichment_analysis_runs SET purged_at=now(),output=NULL,validation_report='{}' WHERE id=$1",
        [analysis],
      );
    return { product, founder, analysis, manifest, release, evidence, claims };
  }
  return { pg, seed };
}
test("SQL reader excludes ineligible published products and retained-source failures", async () => {
  const { pg, seed } = await fixture();
  try {
    await seed("Visible");
    for (const reason of [
      "suppressed-product",
      "suppressed-founder",
      "expired-source",
      "expired-manifest",
      "expired-relationship",
      "retired-release",
      "unapproved-release",
      "wrong-purpose",
      "failed",
      "unpublished",
      "withdraw-source",
      "withdraw-manifest",
      "withdraw-relationship",
      "purged-evidence",
      "purged-relationship",
      "purged-source",
      "purged-analysis",
    ])
      await seed(reason, reason);
    const page = await readProductPage(pg, productQuery({}));
    assert.deepEqual(
      page.products.map((p) => p.name.value),
      ["Visible"],
    );
    assert.equal(page.total, 1);
    assert.equal(page.products[0].website, "https://example.test");
    assert.equal(page.products[0].businessModel.value, null);
    assert.equal(page.products[0].stage.kind, "inference");
    assert.equal(JSON.stringify(page).includes("evidenceIds"), false);
    assert.equal(JSON.stringify(page).includes("input_digest"), false);
  } finally {
    await pg.close();
  }
});
test("SQL search is literal and combined filters, counts, bounded pages use published pointer", async () => {
  const { pg, seed } = await fixture();
  try {
    for (let i = 0; i < 25; i++)
      await seed(`Product ${String(i).padStart(2, "0")}`);
    const visible = await seed("100%_match");
    await pg.query(
      "INSERT INTO enrichment_analysis_runs(id,entity_id,release_id,generation,purpose,input_artifact_id,input_digest,recipe_digest,evidence_ids,output,validation_report,status) VALUES($1,$2,$3,1,'product_descriptions',$4,'new','recipe',$5,$6,'{}','succeeded')",
      [
        randomUUID(),
        visible.product,
        visible.release,
        visible.manifest,
        JSON.stringify([visible.evidence]),
        JSON.stringify({ claims: [claim("name", "Unpublished replacement")] }),
      ],
    );
    assert.equal(
      (await readProductPage(pg, productQuery({ q: "%_" }))).total,
      1,
    );
    assert.equal(
      (await readProductPage(pg, productQuery({ q: "replacement" }))).total,
      0,
    );
    assert.equal(
      (
        await readProductPage(
          pg,
          productQuery({ q: "Doctors", category: "health" }),
        )
      ).total,
      26,
    );
    const none = await readProductPage(
      pg,
      productQuery({ category: "marketing" }),
    );
    assert.equal(none.total, 0);
    assert.equal(none.categories.find((c) => c.id === "health")?.count, 26);
    const first = await readProductPage(pg, productQuery({}));
    const second = await readProductPage(pg, productQuery({ page: "2" }));
    assert.equal(first.products.length, 12);
    assert.equal(second.products.length, 12);
    assert.equal(
      new Set([...first.products, ...second.products].map((p) => p.name.value))
        .size,
      24,
    );
    assert.equal(
      (await readProductPage(pg, productQuery({ page: "99999" }))).page,
      3,
    );
    const handle = first.products[0].founders[0];
    assert.equal(
      (await readProductPage(pg, productQuery({ q: handle }))).total,
      1,
    );
  } finally {
    await pg.close();
  }
});
test("SQL category and literal search match display normalization", async () => {
  const { pg, seed } = await fixture();
  try {
    for (const [name, domain] of [
      ["Long", "x".repeat(2401) + " healthcare"],
      ["Unicode", "😀".repeat(2400) + " healthcare"],
      ["Mixed", "Healthcare marketing AI"],
      ["Unknown", "a novel application"],
    ])
      await seed(name, "", domain);
    const all = await readProductPage(pg, productQuery({}));
    for (const card of all.products) {
      assert.equal(
        (
          await readProductPage(
            pg,
            productQuery({ q: card.name.value!, category: card.category }),
          )
        ).total,
        1,
      );
    }
    for (const q of ['"', "[", "]", "%", "_", "\\", "x".repeat(160)]) {
      assert.equal(
        (await readProductPage(pg, productQuery({ q }))).total,
        productPage(all.products, productQuery({ q })).total,
      );
    }
  } finally {
    await pg.close();
  }
});
test("relationship source suppression and mismatched publication pointers fail closed", async () => {
  const { pg, seed } = await fixture();
  try {
    const entry = await seed("Relations");
    const other = await seed("Other");
    const suppressed = randomUUID();
    await pg.query(
      "INSERT INTO enrichment_entities(id,kind,status) VALUES($1,'founder','suppressed')",
      [suppressed],
    );
    await pg.query(
      "INSERT INTO enrichment_entity_evidence(entity_id,evidence_id,relation) SELECT $1,evidence_id,'source' FROM enrichment_founder_products WHERE product_id=$2",
      [suppressed, entry.product],
    );
    assert.deepEqual(
      (await readProductPage(pg, productQuery({}))).products.map(
        (p) => p.name.value,
      ),
      ["Other"],
    );
    await pg.query(
      "UPDATE enrichment_profiles SET analysis_id=$1 WHERE entity_id=$2",
      [entry.analysis, other.product],
    );
    assert.equal((await readProductPage(pg, productQuery({}))).total, 0);
  } finally {
    await pg.close();
  }
});
test("snapshot preview is explicit, development-only, sanitized and never falls back to DB", async () => {
  const dir = await mkdtemp(join(tmpdir(), "products-"));
  const file = join(dir, "display.json");
  const query = productQuery({});
  try {
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        products: [
          {
            name: { value: "Preview", state: "supported", kind: "self_report" },
            website: "javascript:alert(1)",
            private: "NO_LEAK",
          },
        ],
      }),
    );
    const env = {
      PRODUCTS_LOCAL_SNAPSHOT: file,
      NODE_ENV: "development",
      DATABASE_URL: "must-not-connect",
    };
    const page = await loadProducts(query, env);
    assert.equal(page.total, 1);
    assert.equal(page.preview, "local");
    assert.equal(page.products[0].website, null);
    assert.equal(JSON.stringify(page).includes("NO_LEAK"), false);
    for (const extra of [
      { NODE_ENV: "production" },
      { VERCEL: "1" },
      { PRODUCTS_LOCAL_SNAPSHOT: join(dir, "missing") },
    ])
      assert.equal(
        (await loadProducts(query, { ...env, ...extra })).unavailable,
        true,
      );
    await writeFile(file, "{}");
    assert.equal((await loadProducts(query, env)).unavailable, true);
    assert.deepEqual((await loadProducts(query, {})).products, []);
    const synthetic = productPage([productCard({})], query);
    assert.equal(synthetic.products[0].category, "uncategorized");
  } finally {
    await rm(dir, { recursive: true });
  }
});
