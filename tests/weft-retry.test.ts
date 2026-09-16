import assert from "node:assert/strict";
import { test } from "node:test";
import { WeftClient, WeftError, type FetchResponse } from "@weft-labs/sdk";
import { fetchWithRetry } from "../lib/weft-retry";
import { cleanPlace, normalizePlaces } from "../lib/place";
import { fetchProfile } from "../lib/x";

const request = { url: "https://example.com", maxCostUsd: "0.002" };
const response = (status: number, body: unknown = {}): FetchResponse => ({
  status, merchant: "test", headers: {}, bodyBase64: Buffer.from(JSON.stringify(body)).toString("base64"),
  paidUsd: "0", heldUsd: "0", paymentStatus: "settled", txHash: "", artifactId: 1,
} as unknown as FetchResponse);
const error = (status: number, retryable = false, code = "upstream_error") =>
  new WeftError({ status, retryable, code, message: "test" });

test("observed geography mistakes are rejected or canonicalized", () => {
  assert.deepEqual(cleanPlace({ city: null, country: "Europe" }), { city: null, country: null });
  assert.deepEqual(cleanPlace({ city: "New Jersey", country: "United States of America" }), { city: null, country: "United States" });
});

test("502/504 recover with bounded backoff, unchanged cap and key", async () => {
  const calls: unknown[] = [], delays: number[] = [];
  let i = 0;
  const got = await fetchWithRetry({ fetch: async (r, o) => {
    calls.push({ r, o }); return response([502, 504, 200][i++]);
  } }, request, async ms => { delays.push(ms); });
  assert.equal(got?.status, 200);
  assert.deepEqual(delays, [500, 1000]);
  assert.deepEqual(calls[0], calls[1]); assert.deepEqual(calls[1], calls[2]);
});

test("WeftErrors retry only eligible errors and stop at three", async () => {
  for (const [err, count] of [[error(502), 3], [error(504), 3], [error(503, true), 3],
    [error(400), 1], [error(403, true), 1], [error(502, true, "price_cap_exceeded"), 1],
    [new WeftError({ status: 504, code: "upstream_error", retryable: true, message: "test", details: { paid_usd: "0.001" } }), 1],
    [new Error("ambiguous timeout"), 1]] as const) {
    let calls = 0;
    assert.equal(await fetchWithRetry({ fetch: async () => { calls++; throw err; } }, request, async () => {}), null);
    assert.equal(calls, count);
  }
});

test("pending, held and paid receipts are never replayed", async () => {
  for (const extra of [{ paymentStatus: "pending" as const }, { heldUsd: "0.001" }, { paidUsd: "0.001" }]) {
    let calls = 0;
    await fetchWithRetry({ fetch: async () => { calls++; return { ...response(502), ...extra }; } }, request, async () => {});
    assert.equal(calls, 1);
  }
});

test("app functions fail closed and recover without real paid calls", async () => {
  const original = WeftClient.prototype.fetch;
  const key = process.env.WEFT_API_KEY;
  process.env.WEFT_API_KEY = "test-only";
  try {
    WeftClient.prototype.fetch = async () => { throw error(403); };
    assert.deepEqual((await normalizePlaces(["building cool stuff"])).get("building cool stuff"), {city:null,country:null});
    assert.equal(await fetchProfile("someone", null), null);
    await assert.rejects(normalizePlaces(["Paris"], { strict: true }), /unavailable/);
    WeftClient.prototype.fetch = async () => response(200, {choices:[{message:{content:"[]"}}]});
    await assert.rejects(normalizePlaces(["Paris"], { strict: true }), /incomplete/);
    WeftClient.prototype.fetch = async () => ({ ...response(200), bodyBase64: Buffer.from("not json").toString("base64") });
    assert.deepEqual((await normalizePlaces(["Paris"])).get("Paris"), {city:null,country:null});
    assert.equal(await fetchProfile("someone", null), null);
    let calls = 0;
    WeftClient.prototype.fetch = async () => {
      if (++calls === 1) throw error(504);
      return response(200, {choices:[{message:{content:JSON.stringify([{raw:"Paris",city:"Paris",country:"France"}])}}]});
    };
    assert.deepEqual((await normalizePlaces(["Paris"])).get("Paris"), {city:"Paris",country:"France"});
    assert.equal(calls, 2);
    assert.deepEqual((await normalizePlaces([" Paris "])).get(" Paris "), {city:"Paris",country:"France"});
    calls = 0;
    WeftClient.prototype.fetch = async () => {
      if (++calls === 1) return response(502);
      return response(200, {data:{core:{name:"Someone",screen_name:"someone"},location:{location:"building, cool stuff"}}});
    };
    const profile = await fetchProfile("someone", null);
    assert.equal(profile?.name, "Someone");
    assert.equal(profile?.city, null); assert.equal(profile?.country, null);
    assert.equal(calls, 2);
  } finally {
    WeftClient.prototype.fetch = original;
    if (key === undefined) delete process.env.WEFT_API_KEY; else process.env.WEFT_API_KEY = key;
  }
});
