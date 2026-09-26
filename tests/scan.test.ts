import assert from "node:assert/strict";
import { test } from "node:test";
import type { Founder } from "../lib/model";
import { defaultWeftDependencies } from "../lib/weft";
import {
  BULK_MAX_HYDRATIONS,
  BULK_MAX_SEARCHES,
  BULK_SCAN_PAGES,
  DISCOVER_DEADLINE_MS,
  HYDRATE_DEADLINE_MS,
  HYDRATE_MAX_HYDRATIONS,
  parseCursors,
  parsePendingIntros,
  materializePendingIntros,
  runScan,
  SCAN_DEADLINE_MS,
  SCHEDULED_MAX_HYDRATIONS,
  SCHEDULED_MAX_SEARCHES,
  SCHEDULED_SCAN_PAGES,
  scanDeadlineMs,
  scanLimits,
  unknownHits,
  UPSTREAM_FAIL_STOP,
  type ScanStore,
} from "../lib/scan";
import {
  ProfileUnavailableError,
  TREND_PHRASES,
  type TrendHit,
} from "../lib/x";

function hit(handle: string): TrendHit {
  return {
    handle,
    name: handle,
    text: `I'm a solo founder ${handle}`,
    tweetId: "123",
  };
}

function founderFor(handle: string): Founder {
  return {
    handle,
    name: handle,
    bio: null,
    website: null,
    github: null,
    linkedin: null,
    city: null,
    country: null,
    location: null,
    avatarUrl: null,
    category: "Unclear",
    vibe: { score: 0, label: "Weak founder signal", signals: [] },
    introText: `I'm a solo founder ${handle}`,
    introUrl: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function memoryStore(init?: {
  pending?: TrendHit[];
  cursors?: Record<string, string | null>;
  handles?: string[];
  incomplete?: TrendHit[];
}) {
  const founders = new Set(
    (init?.handles ?? []).map((value) => value.toLowerCase()),
  );
  const record = {
    touches: 0,
    cursors: { ...(init?.cursors ?? {}) },
    pending: [...(init?.pending ?? [])],
    added: [] as string[],
    incomplete: [...(init?.incomplete ?? [])],
  };
  const store: ScanStore = {
    async existingHandles() {
      return new Set(founders);
    },
    async incompleteHits() {
      return [...record.incomplete];
    },
    async upsertFounder(founder) {
      founders.add(founder.handle.toLowerCase());
      record.added.push(founder.handle);
    },
    async insertFounderIfAbsent(founder) {
      const key = founder.handle.toLowerCase();
      if (founders.has(key)) return false;
      founders.add(key);
      record.added.push(founder.handle);
      return true;
    },
    async touchScan() {
      record.touches += 1;
    },
    async loadProgress() {
      return {
        cursors: { ...record.cursors },
        pending: [...record.pending],
      };
    },
    async saveProgress(progress) {
      record.cursors = { ...progress.cursors };
      record.pending = [...progress.pending];
    },
  };
  return { record, store };
}

test("default disabled durable capture leaves hydrate-only intro queue unchanged", async (t) => {
  const queued = [hit("capture_waiting")];
  const { store, record } = memoryStore({ pending: queued });
  t.mock.method(
    defaultWeftDependencies,
    "apiKey",
    () => "synthetic-key-no-provider-call",
  );
  const previous = process.env.ENRICHMENT_ALLOW_PAID;
  process.env.ENRICHMENT_ALLOW_PAID = "0";
  try {
    await assert.rejects(
      runScan({
        store,
        maxSearches: 0,
        maxHydrations: 1,
        normalizePlaces: async () => new Map(),
      }),
      /durable_capture/,
    );
    assert.deepEqual(record.pending, queued);
    assert.deepEqual(record.added, []);
  } finally {
    if (previous === undefined) delete process.env.ENRICHMENT_ALLOW_PAID;
    else process.env.ENRICHMENT_ALLOW_PAID = previous;
  }
});

test("imports every unknown intro instead of dropping a quota", () => {
  const hits = [
    hit("alice"),
    hit("bob"),
    hit("carol"),
    hit("dave"),
    hit("erin"),
    hit("frank"),
    hit("gina"),
    hit("hank"),
    hit("iris"),
    hit("ALICE"),
    hit("bob"),
  ];
  const selected = unknownHits(hits, new Set(["bob"]));
  assert.deepEqual(
    selected.map((row) => row.handle),
    ["alice", "carol", "dave", "erin", "frank", "gina", "hank", "iris"],
  );
});

test("scheduled ticks cap Weft work below one phrase times five pages", () => {
  assert.equal(SCHEDULED_SCAN_PAGES, 5);
  assert.equal(BULK_SCAN_PAGES, 25);
  assert.equal(SCHEDULED_MAX_SEARCHES, 8);
  assert.equal(SCHEDULED_MAX_HYDRATIONS, 15);
  assert.equal(SCAN_DEADLINE_MS, 240_000);
  assert.ok(
    SCHEDULED_MAX_SEARCHES < TREND_PHRASES.length * SCHEDULED_SCAN_PAGES,
  );
  assert.ok(scanLimits(true).maxSearches > scanLimits(false).maxSearches);
  assert.equal(BULK_MAX_SEARCHES, 16);
  assert.equal(BULK_MAX_HYDRATIONS, 30);
  assert.ok(BULK_MAX_SEARCHES < TREND_PHRASES.length * BULK_SCAN_PAGES);
});

test("discover searches without hydrating; hydrate skips search", () => {
  assert.deepEqual(scanLimits("discover"), {
    maxPages: SCHEDULED_SCAN_PAGES,
    maxSearches: SCHEDULED_MAX_SEARCHES,
    maxHydrations: 0,
  });
  assert.deepEqual(scanLimits("hydrate"), {
    maxPages: SCHEDULED_SCAN_PAGES,
    maxSearches: 0,
    maxHydrations: HYDRATE_MAX_HYDRATIONS,
  });
  assert.equal(scanDeadlineMs("discover"), DISCOVER_DEADLINE_MS);
  assert.equal(scanDeadlineMs("hydrate"), HYDRATE_DEADLINE_MS);
  assert.ok(HYDRATE_DEADLINE_MS < 800_000);
  assert.ok(HYDRATE_MAX_HYDRATIONS > SCHEDULED_MAX_HYDRATIONS);
});

test("malformed persisted scan progress fails closed", () => {
  assert.deepEqual(parseCursors(null), {});
  assert.deepEqual(parseCursors("nope"), {});
  assert.deepEqual(parseCursors({ a: 1, b: "c2", d: null }), {
    b: "c2",
    d: null,
  });
  assert.deepEqual(parsePendingIntros(null), []);
  assert.deepEqual(parsePendingIntros([{ handle: "alice" }]), []);
  assert.deepEqual(
    parsePendingIntros([
      { handle: " alice ", name: " Alice Smith ", text: "hi", tweetId: "1" },
    ]),
    [{ handle: "alice", name: "Alice Smith", text: "hi", tweetId: "1" }],
  );
});

test("search cap stops a tick and still calls touchScan when added is 0", async () => {
  const { record, store } = memoryStore({ handles: ["alice"] });
  let searches = 0;
  const result = await runScan({
    store,
    maxSearches: 2,
    maxHydrations: 15,
    maxPages: 5,
    now: () => 0,
    deadlineMs: SCAN_DEADLINE_MS,
    async searchIntroPage(_cursor, phrase) {
      searches += 1;
      return {
        hits: phrase === TREND_PHRASES[0] ? [hit("alice")] : [],
        cursor: `next-${searches}`,
      };
    },
    async fetchProfile() {
      assert.fail("known handles must not be hydrated");
    },
    async normalizePlaces() {
      return new Map();
    },
  });
  assert.equal(searches, 2);
  assert.equal(result.added, 0);
  assert.equal(result.searches, 2);
  assert.equal(result.stopped, "search-cap");
  assert.equal(record.touches, 1);
  assert.equal(record.added.length, 0);
});

test("deadline stops further Weft work before the Vercel cap", async () => {
  const { record, store } = memoryStore();
  let t = 0;
  let searches = 0;
  const result = await runScan({
    store,
    maxSearches: 40,
    maxHydrations: 40,
    maxPages: 25,
    now: () => t,
    deadlineMs: SCAN_DEADLINE_MS,
    async searchIntroPage() {
      searches += 1;
      t += 100_000;
      return { hits: [hit(`user${searches}`)], cursor: `c${searches}` };
    },
    async fetchProfile(handle) {
      return founderFor(handle);
    },
    async normalizePlaces() {
      return new Map();
    },
  });
  assert.equal(searches, 3);
  assert.equal(result.stopped, "deadline");
  assert.ok(t <= SCAN_DEADLINE_MS + 100_000);
  assert.equal(record.touches, 1);
  assert.ok(record.pending.length > 0);
});

test("the next tick resumes each phrase from its stored cursor", async () => {
  const { record, store } = memoryStore();
  const seen: Array<{ cursor?: string; phrase: string }> = [];
  await runScan({
    store,
    maxSearches: 1,
    maxHydrations: 0,
    maxPages: 5,
    now: () => 0,
    async searchIntroPage(cursor, phrase) {
      seen.push({ cursor, phrase });
      return { hits: [hit("alice")], cursor: "page-2" };
    },
    async fetchProfile() {
      return founderFor("unused");
    },
    async normalizePlaces() {
      return new Map();
    },
  });
  assert.equal(record.cursors[TREND_PHRASES[0]], "page-2");
  await runScan({
    store,
    maxSearches: 1,
    maxHydrations: 0,
    maxPages: 5,
    now: () => 0,
    async searchIntroPage(cursor, phrase) {
      seen.push({ cursor, phrase });
      return { hits: [hit("bob")], cursor: "page-3" };
    },
    async fetchProfile() {
      return founderFor("unused");
    },
    async normalizePlaces() {
      return new Map();
    },
  });
  assert.deepEqual(seen, [
    { cursor: undefined, phrase: TREND_PHRASES[0] },
    { cursor: "page-2", phrase: TREND_PHRASES[0] },
  ]);
  assert.equal(record.cursors[TREND_PHRASES[0]], "page-3");
});

test("unhydrated intros survive to the next runScan and are hydrated first", async () => {
  const { record, store } = memoryStore();
  const first = await runScan({
    store,
    maxSearches: 1,
    maxHydrations: 1,
    maxPages: 5,
    now: () => 0,
    async searchIntroPage() {
      return { hits: [hit("alice"), hit("bob"), hit("carol")], cursor: "p2" };
    },
    async fetchProfile(handle) {
      return founderFor(handle);
    },
    async normalizePlaces() {
      return new Map();
    },
  });
  assert.equal(first.added, 1);
  assert.equal(record.added[0], "alice");
  assert.deepEqual(
    record.pending.map((row) => row.handle),
    ["bob", "carol"],
  );

  let searched = 0;
  const hydrated: string[] = [];
  const second = await runScan({
    store,
    maxSearches: 0,
    maxHydrations: 2,
    maxPages: 5,
    now: () => 0,
    async searchIntroPage() {
      searched += 1;
      return { hits: [], cursor: null };
    },
    async fetchProfile(handle) {
      hydrated.push(handle);
      return founderFor(handle);
    },
    async normalizePlaces() {
      return new Map();
    },
  });
  assert.equal(searched, 0);
  assert.deepEqual(hydrated, ["bob", "carol"]);
  assert.equal(second.added, 2);
  assert.deepEqual(record.pending, []);
  assert.equal(record.touches, 2);
});

test("a 502 profile fetch keeps the intro queued instead of storing a stub", async () => {
  const intro = { ...hit("alice"), name: "Alice Smith" };
  const { record, store } = memoryStore({ pending: [intro] });
  const result = await runScan({
    store,
    maxSearches: 0,
    maxHydrations: 1,
    maxPages: 5,
    now: () => 0,
    async searchIntroPage() {
      return { hits: [], cursor: null };
    },
    async fetchProfile() {
      throw new ProfileUnavailableError(502);
    },
    async normalizePlaces() {
      return new Map();
    },
  });

  assert.equal(result.added, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.pending, 1);
  assert.deepEqual(record.pending, [intro]);
  assert.deepEqual(record.added, []);
});

test("hydrate retries a 502 on the next tick", async () => {
  const { record, store } = memoryStore({ pending: [hit("alice")] });
  let hydrateCalls = 0;
  await runScan({
    store,
    maxSearches: 0,
    maxHydrations: 1,
    maxPages: 5,
    now: () => 0,
    async searchIntroPage() {
      return { hits: [], cursor: null };
    },
    async fetchProfile() {
      hydrateCalls += 1;
      throw new ProfileUnavailableError(502);
    },
    async normalizePlaces() {
      return new Map();
    },
  });
  assert.deepEqual(record.added, []);
  assert.deepEqual(
    record.pending.map((row) => row.handle),
    ["alice"],
  );

  await runScan({
    store,
    maxSearches: 0,
    maxHydrations: 1,
    maxPages: 5,
    now: () => 0,
    async searchIntroPage() {
      return { hits: [], cursor: null };
    },
    async fetchProfile() {
      hydrateCalls += 1;
      return { ...founderFor("alice"), avatarUrl: "https://img.test/a.jpg" };
    },
    async normalizePlaces() {
      return new Map();
    },
  });
  assert.equal(hydrateCalls, 2);
  assert.deepEqual(record.added, ["alice"]);
  assert.deepEqual(record.pending, []);
});

test("hydrate re-fetches stored rows that have no avatar", async () => {
  const { record, store } = memoryStore({
    handles: ["alice"],
    incomplete: [hit("alice")],
  });
  const hydrated: string[] = [];
  const result = await runScan({
    store,
    maxSearches: 0,
    maxHydrations: 1,
    maxPages: 5,
    now: () => 0,
    async searchIntroPage() {
      return { hits: [], cursor: null };
    },
    async fetchProfile(handle) {
      hydrated.push(handle);
      return { ...founderFor(handle), avatarUrl: "https://img.test/a.jpg" };
    },
    async normalizePlaces() {
      return new Map();
    },
  });
  assert.deepEqual(hydrated, ["alice"]);
  assert.equal(result.added, 1);
  assert.deepEqual(record.added, ["alice"]);
  assert.deepEqual(record.pending, []);
});

test("a cluster of 502s stops the tick and leaves the rest queued", async () => {
  const pending = [
    "alice",
    "bob",
    "carol",
    "dave",
    "erin",
    "frank",
    "gina",
    "hank",
    "ivy",
    "jade",
  ].map(hit);
  const { record, store } = memoryStore({ pending });
  const hydrated: string[] = [];
  const result = await runScan({
    store,
    maxSearches: 0,
    maxHydrations: 50,
    maxPages: 5,
    now: () => 0,
    async searchIntroPage() {
      return { hits: [], cursor: null };
    },
    async fetchProfile(handle) {
      hydrated.push(handle);
      throw new ProfileUnavailableError(502);
    },
    async normalizePlaces() {
      return new Map();
    },
  });
  assert.equal(hydrated.length, UPSTREAM_FAIL_STOP);
  assert.equal(result.stopped, "upstream");
  assert.equal(result.added, 0);
  assert.equal(record.pending.length, pending.length);
});

test("an operator materializes only sourced queued intros without a paid call", async () => {
  const { record, store } = memoryStore({
    pending: [hit("alice"), hit("bob"), { ...hit("carol"), tweetId: null }],
  });

  const result = await materializePendingIntros(store);

  assert.deepEqual(result, { added: 2, skipped: 1 });
  assert.deepEqual(record.added, ["alice", "bob"]);
  assert.deepEqual(record.pending, [
    hit("alice"),
    hit("bob"),
    { ...hit("carol"), tweetId: null },
  ]);
  assert.equal(record.touches, 1);
});

test("discover does not call fetchProfile; hydrate does not search", async () => {
  const { record, store } = memoryStore();
  const discovered = await runScan({
    store,
    ...scanLimits("discover"),
    now: () => 0,
    deadlineMs: scanDeadlineMs("discover"),
    async searchIntroPage() {
      return { hits: [hit("alice"), hit("bob")], cursor: "p2" };
    },
    async fetchProfile() {
      assert.fail("discover must not hydrate");
    },
    async normalizePlaces() {
      return new Map();
    },
  });
  assert.equal(discovered.added, 0);
  assert.equal(discovered.hydrations, 0);
  assert.equal(discovered.searches, SCHEDULED_MAX_SEARCHES);
  assert.deepEqual(
    record.pending.map((row) => row.handle),
    ["alice", "bob"],
  );

  const hydrated: string[] = [];
  let searched = 0;
  const second = await runScan({
    store,
    ...scanLimits("hydrate"),
    now: () => 0,
    deadlineMs: scanDeadlineMs("hydrate"),
    async searchIntroPage() {
      searched += 1;
      return { hits: [hit("should-not-search")], cursor: "nope" };
    },
    async fetchProfile(handle) {
      hydrated.push(handle);
      return founderFor(handle);
    },
    async normalizePlaces() {
      return new Map();
    },
  });
  assert.equal(searched, 0);
  assert.deepEqual(hydrated, ["alice", "bob"]);
  assert.equal(second.added, 2);
  assert.equal(record.cursors[TREND_PHRASES[0]], "p2");
});

test("retweet-only pages keep the cursor so history walking continues", async () => {
  const { record, store } = memoryStore();
  await runScan({
    store,
    maxSearches: 1,
    maxHydrations: 1,
    maxPages: 5,
    now: () => 0,
    async searchIntroPage() {
      return { hits: [], cursor: "after-rts" };
    },
    async fetchProfile() {
      return founderFor("unused");
    },
    async normalizePlaces() {
      return new Map();
    },
  });
  assert.equal(record.cursors[TREND_PHRASES[0]], "after-rts");
  assert.equal(record.touches, 1);
});
