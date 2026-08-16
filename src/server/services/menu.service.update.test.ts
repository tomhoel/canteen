/**
 * Tests for runWeeklyUpdateService — the only thing that writes menu data.
 *
 * Until now only its pure helpers were covered, which is how a data-loss bug
 * got shipped into the write loop last session: a failed Supabase read was
 * indistinguishable from an empty row, so the merge became a destructive full
 * replace. Nothing here would have compiled differently; the loop just had to
 * be run.
 *
 * Seam: `node:test`'s module mocking, so the real function runs unmodified and
 * the ordering between scrape, credential check, read, enrich and upsert is the
 * thing under test rather than a re-implementation of it. Three rules, all
 * learned by watching them fail silently:
 *
 *   1. One `mock.module` per specifier, at module top level, before the subject
 *      is imported. `t.mock.module` inside a test does not re-mock a specifier
 *      that is already mocked — it fails quietly and the second test runs the
 *      first test's fake.
 *   2. Every mock delegates to a mutable holder that `reset()` reinitialises,
 *      because the subject's bindings freeze at first load.
 *   3. The subject is imported with a top-level `await import`, after the mocks
 *      register. A static import would hoist above them.
 *
 * Requires --experimental-test-module-mocks; see the `test` script.
 */
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import type { MenuData, CanteenData } from "../../lib/types.js";
import type { ScrapeReport } from "./scraper.service.js";
import { getWeekId, getWeekIdOffset } from "../../lib/dateUtils.js";

// ── Test doubles ──────────────────────────────────────────────────────────

interface StoredRowShape {
  menu_data: Record<string, unknown> | null;
  dish_origins: Record<string, unknown>;
  dish_descriptions: Record<string, unknown>;
}

interface Upsert {
  weekId: string;
  payload: Record<string, any>;
}

/** Everything a test can steer, and everything it can observe afterwards. */
interface World {
  scrape: ScrapeReport;
  /** Stored rows by week id. A missing key is "no row"; a value of "fail" is a read error. */
  rows: Map<string, StoredRowShape | "fail">;
  /** Week ids whose upsert should be rejected by Supabase. */
  rejectUpsert: Set<string>;
  /** Dish names the model refuses to answer for, per pass. */
  silentOrigins: Set<string>;
  silentDescriptions: Set<string>;
  cacheRows: Map<string, Record<string, any>>;
  redisAvailable: boolean;
  redisWritesFail: boolean;

  upserts: Upsert[];
  cacheWrites: Array<Record<string, unknown>[]>;
  originsAsked: string[][];
  descriptionsAsked: string[][];
  redisSets: string[];
  redisConstructed: number;
  trace: string[];
}

let world: World;

function makeCanteen(week: string, dishes: string[] = ["Fiskesuppe"]): CanteenData {
  return {
    week,
    openingHours: "11:00 - 13:30",
    menu: [
      {
        day: "Monday",
        no: { label: "MANDAG", items: dishes.map((d) => ({ dish: d, isMain: true, allergens: [] })) },
      },
    ],
  } as CanteenData;
}

function makeScrape(canteens: Record<string, CanteenData>, failed: string[] = []): ScrapeReport {
  return {
    menuData: { scrapedAt: "2026-08-14T00:00:00.000Z", canteens } as MenuData,
    results: [],
    failed,
  };
}

function reset(overrides: Partial<World> = {}) {
  world = {
    scrape: makeScrape({ Flow: makeCanteen("Uke/Week 33") }),
    rows: new Map(),
    rejectUpsert: new Set(),
    silentOrigins: new Set(),
    silentDescriptions: new Set(),
    cacheRows: new Map(),
    redisAvailable: false,
    redisWritesFail: false,
    upserts: [],
    cacheWrites: [],
    originsAsked: [],
    descriptionsAsked: [],
    redisSets: [],
    redisConstructed: 0,
    trace: [],
    ...overrides,
  };

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
}

reset();

// ── Mocks ─────────────────────────────────────────────────────────────────

mock.module("./scraper.service.js", {
  namedExports: {
    scrapeAllCanteens: async () => {
      world.trace.push("scrape");
      return world.scrape;
    },
  },
});

mock.module("./ai.service.js", {
  namedExports: {
    detectDishOrigins: async (dishes: string[]) => {
      world.originsAsked.push([...dishes]);
      const values: Record<string, unknown> = {};
      const fromModel = new Set<string>();
      for (const d of dishes) {
        values[d] = { code: "no", country: "Norway" };
        if (!world.silentOrigins.has(d)) fromModel.add(d);
      }
      return { values, fromModel };
    },
    generateDishDescriptions: async (dishes: string[]) => {
      world.descriptionsAsked.push([...dishes]);
      const values: Record<string, unknown> = {};
      const fromModel = new Set<string>();
      for (const d of dishes) {
        values[d] = { no: `om ${d}`, en: `about ${d}` };
        if (!world.silentDescriptions.has(d)) fromModel.add(d);
      }
      return { values, fromModel };
    },
    fallbackOrigin: (dish: string) => ({ code: "fb", country: `fallback:${dish}` }),
    fallbackDescription: (dish: string) => ({ no: `fallback:${dish}`, en: `fallback:${dish}` }),
  },
});

mock.module("@upstash/redis", {
  namedExports: {
    Redis: class {
      constructor() {
        world.redisConstructed++;
      }
      async get() {
        return null;
      }
      async set(key: string) {
        if (world.redisWritesFail) throw new Error("redis down");
        world.redisSets.push(key);
      }
    },
  },
});

/**
 * The slice of the supabase-js query builder the service actually uses.
 * Deliberately hand-rolled rather than generic: if the service starts issuing a
 * query shape this does not model, the test should fail loudly.
 */
function makeSupabaseClient() {
  return {
    from(table: string) {
      if (table === "dish_cache") return dishCacheBuilder();
      if (table === "weekly_menus") return weeklyMenusBuilder();
      throw new Error(`unexpected table ${table}`);
    },
  };
}

function dishCacheBuilder() {
  return {
    select() {
      return {
        in(_col: string, keys: string[]) {
          const data = keys.map((k) => world.cacheRows.get(k)).filter(Boolean);
          return Promise.resolve({ data, error: null });
        },
      };
    },
    upsert(rows: Record<string, unknown>[]) {
      world.cacheWrites.push(rows);

      // Postgres rejects an INSERT ... ON CONFLICT whose proposed rows collide
      // on the conflict target ("cannot affect row a second time"), and it
      // aborts the whole statement — so a single duplicate would discard every
      // other dish in the batch. Modelled here so the test can prove the
      // dedup, rather than passing because the fake is more forgiving than
      // the database.
      const keys = rows.map((r) => r.cache_key as string);
      if (new Set(keys).size !== keys.length) {
        return Promise.resolve({
          error: { message: "ON CONFLICT DO UPDATE command cannot affect row a second time" },
        });
      }

      // Columns absent from a row in a *mixed* batch would be NULLed by
      // PostgREST, since the ?columns= list is the union across the batch.
      const columns = new Set(rows.flatMap((r) => Object.keys(r)));
      for (const row of rows) {
        const key = row.cache_key as string;
        const stored = { ...(world.cacheRows.get(key) ?? {}) };
        for (const column of columns) {
          stored[column] = column in row ? row[column] : null;
        }
        world.cacheRows.set(key, stored);
      }
      return Promise.resolve({ error: null });
    },
  };
}

function weeklyMenusBuilder() {
  const builder: any = {
    select() {
      return builder;
    },
    eq(_col: string, weekId: string) {
      builder._weekId = weekId;
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      builder._latest = true;
      return builder;
    },
    maybeSingle() {
      if (builder._latest) {
        const ids = [...world.rows.keys()].sort().reverse();
        const id = ids.find((i) => world.rows.get(i) !== "fail");
        const row = id ? (world.rows.get(id) as StoredRowShape) : null;
        return Promise.resolve({ data: row ? { week_id: id, ...row } : null, error: null });
      }
      const weekId = builder._weekId as string;
      world.trace.push(`read:${weekId}`);
      const stored = world.rows.get(weekId);
      if (stored === "fail") {
        return Promise.resolve({ data: null, error: { message: "connection reset" } });
      }
      if (!stored) return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: { week_id: weekId, ...stored }, error: null });
    },
    upsert(payload: Record<string, any>) {
      const weekId = payload.week_id as string;
      world.trace.push(`upsert:${weekId}`);
      if (world.rejectUpsert.has(weekId)) {
        return Promise.resolve({ error: { message: "permission denied" } });
      }
      world.upserts.push({ weekId, payload });
      world.rows.set(weekId, {
        menu_data: payload.menu_data,
        dish_origins: payload.dish_origins,
        dish_descriptions: payload.dish_descriptions,
      });
      return Promise.resolve({ error: null });
    },
  };
  return builder;
}

mock.module("@supabase/supabase-js", {
  namedExports: {
    createClient: (_url: string, _key: string) => makeSupabaseClient(),
  },
});

const { runWeeklyUpdateService, PartialUpdateError } = await import("./menu.service.js");

// Week ids derived from the real calendar rather than hardcoded, so these tests
// still mean the same thing next August — including across the year boundary,
// where "this week + 1" is week 1 of the next week-year, not week 53.
const W_NOW = getWeekId();
const W_A = W_NOW;
const W_B = getWeekIdOffset(1);

/** A label routed to the calendar week. */
function label(weeksAhead: 0 | 1): string {
  const weekId = weeksAhead === 0 ? W_NOW : W_B;
  return `Uke/Week ${Number(weekId.slice(-2))}`;
}

function storedRow(canteens: Record<string, CanteenData>, fingerprint?: string): StoredRowShape {
  return {
    menu_data: { scrapedAt: "old", canteens, ...(fingerprint ? { fingerprint } : {}) },
    dish_origins: {},
    dish_descriptions: {},
  };
}

// ── Multi-week split ──────────────────────────────────────────────────────

test("writes one row per published week when the kitchens are mid-rollover", async () => {
  reset({
    scrape: makeScrape({
      Flow: makeCanteen(label(0), ["Fiskesuppe"]),
      Fresh4you: makeCanteen(label(1), ["Tacos"]),
      "Eat the street": makeCanteen(label(1), ["Tacos"]),
    }),
  });

  const result = await runWeeklyUpdateService();

  assert.deepEqual(
    result.weeksWritten.map((w) => w.weekId),
    [W_A, W_B],
    "weeks are written in sorted order"
  );
  // Only the canteens the label routed here — not the merged set, which also
  // contains the seeded laggard.
  assert.deepEqual(result.weeksWritten[0].canteens, ["Flow"]);
  assert.deepEqual(result.weeksWritten[1].canteens.sort(), ["Eat the street", "Fresh4you"]);
  assert.equal(result.weeksSkipped.length, 0);
});

test("an unreadable week label is filed under the calendar week, never dropped", async () => {
  reset({
    scrape: makeScrape({
      Flow: makeCanteen("Bygg / Building M", ["Fiskesuppe"]),
      Fresh4you: makeCanteen(label(0), ["Tacos"]),
    }),
  });

  const result = await runWeeklyUpdateService();

  assert.deepEqual(result.weeksWritten.map((w) => w.weekId), [W_NOW]);
  assert.deepEqual(Object.keys(result.menuData.canteens).sort(), ["Flow", "Fresh4you"]);
});

test("an implausible week number is filed under the calendar week", async () => {
  // A bare building number parses as a week number, and in August "Bygg 2"
  // resolves to next January — a junk primary key nothing ever reads. The
  // number is derived rather than written down because "2" is only implausible
  // for most of the year: in late December it is a fortnight away and the
  // guard, correctly, lets it through.
  const implausible = ((Number(W_NOW.slice(-2)) + 25) % 52) + 1;
  reset({ scrape: makeScrape({ Flow: makeCanteen(`Bygg ${implausible}`, ["Fiskesuppe"]) }) });

  const result = await runWeeklyUpdateService();

  assert.deepEqual(result.weeksWritten.map((w) => w.weekId), [W_NOW]);
});

// ── Read failure ──────────────────────────────────────────────────────────

test("a failed read skips that week rather than replacing it", async () => {
  // The bug this test exists for: treating a read error as an empty row turns
  // the merge into a full replace and deletes every canteen this scrape did not
  // see, from a week whose upstream pages are already gone.
  reset({
    scrape: makeScrape({
      Flow: makeCanteen(label(0), ["Fiskesuppe"]),
      Fresh4you: makeCanteen(label(1), ["Tacos"]),
    }),
    rows: new Map([[W_A, "fail"]]),
  });

  const result = await runWeeklyUpdateService();

  assert.deepEqual(result.weeksSkipped, [{ weekId: W_A, reason: "connection reset" }]);
  assert.deepEqual(result.weeksWritten.map((w) => w.weekId), [W_B]);
  assert.ok(
    !world.trace.includes(`upsert:${W_A}`),
    "the week whose row could not be read is never written"
  );
});

test("a week with no stored row yet is a miss, not a skip", async () => {
  reset({ scrape: makeScrape({ Flow: makeCanteen(label(0)) }) });

  const result = await runWeeklyUpdateService();

  assert.equal(result.weeksSkipped.length, 0);
  assert.deepEqual(result.weeksWritten.map((w) => w.weekId), [W_A]);
});

test("when every week is skipped the run throws and writes nothing", async () => {
  reset({
    scrape: makeScrape({ Flow: makeCanteen(label(0)) }),
    rows: new Map([[W_A, "fail"]]),
  });

  await assert.rejects(runWeeklyUpdateService(), /No week could be written/);
  assert.equal(world.upserts.length, 0);
});

// ── Merge precedence ──────────────────────────────────────────────────────

test("stored canteens survive, this week's scrape wins, the laggard is seeded", async () => {
  reset({
    scrape: makeScrape({
      Flow: makeCanteen(label(0), ["Fiskesuppe"]),
      Fresh4you: makeCanteen(label(1), ["Tacos"]),
    }),
    rows: new Map([
      [
        W_A,
        storedRow({
          Flow: makeCanteen("Uke 1", ["Gammel suppe"]),
          "Eat the street": makeCanteen(label(0), ["Lasagne"]),
        }),
      ],
    ]),
  });

  await runWeeklyUpdateService();

  const weekA = world.upserts.find((u) => u.weekId === W_A)!.payload.menu_data.canteens;
  assert.equal(weekA.Flow.week, label(0), "the scrape outranks the stored entry");
  assert.ok(weekA["Eat the street"], "a stored canteen this scrape did not route here survives");
  assert.equal(weekA.Fresh4you.week, label(1), "a cross-week canteen is seeded with its own label");

  const weekB = world.upserts.find((u) => u.weekId === W_B)!.payload.menu_data.canteens;
  assert.equal(weekB.Flow.week, label(0), "the laggard is seeded into next week's new row");
});

test("a seed never overwrites what the target row already stores", async () => {
  reset({
    scrape: makeScrape({
      Flow: makeCanteen(label(0), ["Fiskesuppe"]),
      Fresh4you: makeCanteen(label(1), ["Tacos"]),
    }),
    rows: new Map([[W_B, storedRow({ Flow: makeCanteen(label(1), ["Allerede lagret"]) })]]),
  });

  await runWeeklyUpdateService();

  const weekB = world.upserts.find((u) => u.weekId === W_B)!.payload.menu_data.canteens;
  assert.equal(weekB.Flow.week, label(1), "the stored week-ahead entry outranks the seed");
});

// ── Partial failure ───────────────────────────────────────────────────────

test("a rejected upsert on the second week reports the first as committed", async () => {
  reset({
    scrape: makeScrape({
      Flow: makeCanteen(label(0), ["Fiskesuppe"]),
      Fresh4you: makeCanteen(label(1), ["Tacos"]),
    }),
    rejectUpsert: new Set([W_B]),
  });

  await assert.rejects(runWeeklyUpdateService(), (err: any) => {
    assert.ok(err instanceof PartialUpdateError);
    // api/cron/update.ts duck-types this to tell the operator which weeks did
    // land — "the stored menu was left untouched" would send them looking in
    // the wrong place.
    assert.deepEqual(err.weeksWritten.map((w: any) => w.weekId), [W_A]);
    return /permission denied/.test(err.message);
  });
});

test("a rejected upsert on the first week reports nothing as committed", async () => {
  reset({
    scrape: makeScrape({
      Flow: makeCanteen(label(0), ["Fiskesuppe"]),
      Fresh4you: makeCanteen(label(1), ["Tacos"]),
    }),
    rejectUpsert: new Set([W_A]),
  });

  await assert.rejects(runWeeklyUpdateService(), (err: any) => {
    assert.deepEqual(err.weeksWritten, []);
    return true;
  });
});

test("a failing Redis does not fail the run", async () => {
  // The cache is written after the database on purpose; a cache that cannot be
  // reached must not turn a successful persist into a failed run.
  reset({ redisWritesFail: true });
  process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "token";

  try {
    const result = await runWeeklyUpdateService();

    assert.equal(result.weeksWritten.length, 1);
    assert.equal(world.redisSets.length, 0, "nothing was cached");
    assert.equal(world.upserts.length, 1, "but the row was still stored");
  } finally {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  }
});

test("a successful run caches every week it wrote", async () => {
  reset({
    scrape: makeScrape({
      Flow: makeCanteen(label(0), ["Fiskesuppe"]),
      Fresh4you: makeCanteen(label(1), ["Tacos"]),
    }),
  });
  process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "token";

  try {
    await runWeeklyUpdateService();
    assert.deepEqual(world.redisSets, [`menu:${W_A}`, `menu:${W_B}`]);
  } finally {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  }
});

test("no Redis configured means no client is ever constructed", async () => {
  reset();

  await runWeeklyUpdateService();

  assert.equal(world.redisConstructed, 0);
});

// ── Explicit week id (the `npm run update -- --week` path) ────────────────

test("an explicit week id overrides what the canteens advertise", async () => {
  reset({
    scrape: makeScrape({
      Flow: makeCanteen(label(0), ["Fiskesuppe"]),
      Fresh4you: makeCanteen(label(1), ["Tacos"]),
    }),
  });

  const result = await runWeeklyUpdateService(W_B);

  assert.deepEqual(result.weeksWritten.map((w) => w.weekId), [W_B]);
  assert.deepEqual(result.weeksWritten[0].canteens.sort(), ["Flow", "Fresh4you"]);
  assert.equal(result.weekId, W_B, "the named week is the one returned, images and all");
  assert.deepEqual(
    world.trace.filter((t) => t.startsWith("upsert:")),
    [`upsert:${W_B}`],
    "exactly one row is written"
  );
});

test("an explicit week id whose row cannot be read fails cleanly", async () => {
  // Guards the non-null assertion on writtenRecords.get(weekIdInput): if the
  // only week is skipped there is no record to return, and the error must say
  // so rather than dereferencing undefined.
  reset({
    scrape: makeScrape({ Flow: makeCanteen(label(0)) }),
    rows: new Map([[W_B, "fail"]]),
  });

  await assert.rejects(runWeeklyUpdateService(W_B), (err: any) => {
    assert.ok(!(err instanceof TypeError), `expected a clean error, got ${err}`);
    return /No week could be written/.test(err.message);
  });
});

// ── Ordering and refusals ─────────────────────────────────────────────────

test("an empty scrape throws before anything is written", async () => {
  reset({ scrape: makeScrape({ Flow: { week: label(0), openingHours: "", menu: [] } as CanteenData }) });

  await assert.rejects(runWeeklyUpdateService(), /refusing to overwrite stored data/);
  assert.equal(world.upserts.length, 0);
});

test("a missing service-role key refuses to write with the anon key", async () => {
  reset();
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  await assert.rejects(runWeeklyUpdateService(), /refusing to write with the anon key/);
  assert.deepEqual(world.trace, ["scrape"], "the refusal comes after the scrape, before any read");

  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
});

test("canteens that failed to scrape are reported, not swallowed", async () => {
  reset({
    scrape: makeScrape({ Flow: makeCanteen(label(0)) }, ["Fresh4you", "Eat the street"]),
  });

  const result = await runWeeklyUpdateService();

  assert.deepEqual(result.stats.failedCanteens, ["Fresh4you", "Eat the street"]);
});

// ── Enrichment ────────────────────────────────────────────────────────────

test("a fully cached week costs no model call", async () => {
  reset({ scrape: makeScrape({ Flow: makeCanteen(label(0), ["Fiskesuppe"]) }) });
  world.cacheRows.set("fiskesuppe", {
    cache_key: "fiskesuppe",
    original_name: "Fiskesuppe",
    origin: { code: "no", country: "Norway" },
    description: { no: "lagret", en: "stored" },
  });

  const result = await runWeeklyUpdateService();

  assert.deepEqual(world.originsAsked, [[]]);
  assert.deepEqual(world.descriptionsAsked, [[]]);
  assert.equal(result.stats.fromCache, 1);
  assert.equal(result.stats.sentToModel, 0);
});

test("each pass is asked only about the field it is missing", async () => {
  // The AND-filter this replaces threw away a model-answered origin whenever
  // the description pass failed for the same dish, then paid to ask again.
  reset({ scrape: makeScrape({ Flow: makeCanteen(label(0), ["Fiskesuppe"]) }) });
  world.cacheRows.set("fiskesuppe", {
    cache_key: "fiskesuppe",
    original_name: "Fiskesuppe",
    origin: { code: "no", country: "Norway" },
    description: null,
  });

  await runWeeklyUpdateService();

  assert.deepEqual(world.originsAsked, [[]], "the cached origin is not re-asked");
  assert.deepEqual(world.descriptionsAsked, [["Fiskesuppe"]]);
});

test("a half-answered dish keeps the half that worked", async () => {
  // The exact case the AND-filter threw away: the origin pass lands, the
  // description pass times out, and both answers were discarded — so the next
  // run paid to ask for an origin it had already been given.
  reset({
    scrape: makeScrape({ Flow: makeCanteen(label(0), ["Fiskesuppe"]) }),
    silentDescriptions: new Set(["Fiskesuppe"]),
  });

  const first = await runWeeklyUpdateService();

  const row = world.cacheRows.get("fiskesuppe")!;
  assert.ok(row.origin, "the origin the model did answer is persisted");
  assert.equal(row.description, undefined, "the fallback description is not");
  assert.equal(row.enrich_attempts, 1, "and the failed half is counted");
  assert.deepEqual(first.stats.unresolved, ["Fiskesuppe"]);

  // Second run: only the missing half is re-asked.
  world.silentDescriptions = new Set();
  world.originsAsked = [];
  world.descriptionsAsked = [];
  const second = await runWeeklyUpdateService();

  assert.deepEqual(world.originsAsked, [[]], "the stored origin is not paid for twice");
  assert.deepEqual(world.descriptionsAsked, [["Fiskesuppe"]]);
  assert.deepEqual(second.stats.unresolved, []);
  assert.equal(world.cacheRows.get("fiskesuppe")!.enrich_attempts, 0, "recovery clears the counter");
});

test("a partial write does not blank the field another run filled in", async () => {
  // postgrest builds the request's column list from the union of the keys across
  // the batch, so an origin-only row travelling with a full one would NULL that
  // row's description. Every upsert batch must therefore be homogeneous.
  reset({
    scrape: makeScrape({ Flow: makeCanteen(label(0), ["Halvveis", "Komplett"]) }),
    silentDescriptions: new Set(["Halvveis"]),
  });

  await runWeeklyUpdateService();

  for (const batch of world.cacheWrites) {
    const shapes = new Set(batch.map((row) => Object.keys(row).sort().join(",")));
    assert.equal(shapes.size, 1, `mixed shapes in one upsert: ${[...shapes].join(" | ")}`);
  }
  assert.ok(world.cacheRows.get("komplett")!.description, "the complete dish keeps its description");
  assert.equal(world.cacheRows.get("halvveis")!.description, undefined);
});

test("a dish the model never answers for is counted, and eventually dropped", async () => {
  reset({
    scrape: makeScrape({ Flow: makeCanteen(label(0), ["Ukjent rett"]) }),
    silentOrigins: new Set(["Ukjent rett"]),
    silentDescriptions: new Set(["Ukjent rett"]),
  });

  // Four consecutive silent runs: the counter climbs and the dish keeps being
  // asked about, because giving up after one bad afternoon would be wrong.
  for (let i = 1; i <= 4; i++) {
    world.originsAsked = [];
    const result = await runWeeklyUpdateService();
    assert.deepEqual(world.originsAsked, [["Ukjent rett"]], `run ${i} still asks`);
    assert.deepEqual(result.stats.unresolved, ["Ukjent rett"]);
    assert.deepEqual(result.stats.exhausted, [], `run ${i} has not given up yet`);
    assert.equal(world.cacheRows.get("ukjent rett")!.enrich_attempts, i);
    // Nothing durable is ever written for it — the fallback must stay out of
    // the cache, or the dish is silently canned forever.
    assert.equal(world.cacheRows.get("ukjent rett")!.origin, undefined);
  }

  world.originsAsked = [];
  const fifth = await runWeeklyUpdateService();
  assert.deepEqual(fifth.stats.exhausted, ["Ukjent rett"], "the fifth try is the last");
  assert.deepEqual(fifth.stats.newlyExhausted, ["Ukjent rett"], "and that is the run that alerts");

  world.originsAsked = [];
  const sixth = await runWeeklyUpdateService();
  assert.deepEqual(world.originsAsked, [[]], "and it is never sent again");
  assert.deepEqual(sixth.stats.exhausted, ["Ukjent rett"], "but it stays visible");
  assert.deepEqual(sixth.stats.newlyExhausted, [], "without alerting a second time");
});

test("a fallback never overwrites what the row already stores", async () => {
  reset({
    scrape: makeScrape({ Flow: makeCanteen(label(0), ["Fiskesuppe"]) }),
    silentOrigins: new Set(["Fiskesuppe"]),
    silentDescriptions: new Set(["Fiskesuppe"]),
  });
  world.rows.set(W_A, {
    menu_data: { scrapedAt: "old", canteens: { Flow: makeCanteen(label(0), ["Fiskesuppe"]) } },
    dish_origins: { Fiskesuppe: { code: "se", country: "Sweden" } },
    dish_descriptions: { Fiskesuppe: { no: "ekte", en: "real" } },
  });

  const result = await runWeeklyUpdateService();

  assert.deepEqual(
    result.dishOrigins.Fiskesuppe,
    { code: "se", country: "Sweden" },
    "a rate-limited run must not rewrite a good answer as boilerplate"
  );
  assert.deepEqual(result.dishDescriptions.Fiskesuppe, { no: "ekte", en: "real" });
});

test("an unchanged week still tops up the dishes that are missing enrichment", async () => {
  // The fingerprint short-circuit used to skip enrichment entirely, which made
  // "will retry next run" false: a failed dish was never asked about again for
  // as long as the kitchens published the same food.
  reset({
    scrape: makeScrape({ Flow: makeCanteen(label(0), ["Fiskesuppe"]) }),
    silentOrigins: new Set(["Fiskesuppe"]),
    silentDescriptions: new Set(["Fiskesuppe"]),
  });

  await runWeeklyUpdateService();
  const fingerprint = world.upserts[0].payload.menu_data.fingerprint;
  assert.ok(fingerprint, "the fingerprint rides inside menu_data");

  world.silentOrigins = new Set();
  world.silentDescriptions = new Set();
  world.originsAsked = [];
  const second = await runWeeklyUpdateService();

  assert.equal(second.weeksWritten[0].unchanged, true, "the menu itself did not change");
  assert.deepEqual(world.originsAsked, [["Fiskesuppe"]], "the failed dish is retried anyway");
  assert.deepEqual(second.stats.unresolved, []);
  assert.ok(world.cacheRows.get("fiskesuppe")!.origin, "and is durably cached this time");
});

test("two dish names that normalise to one key do not abort the batch", async () => {
  // The kitchen writes the same dish two ways in the same week — the
  // normaliser strips the punctuation that separates them, so both entries
  // carry the same cache_key. Postgres aborts the entire statement on a
  // duplicate conflict target, which would silently discard every other dish's
  // origin, description and attempt counter along with it.
  reset({
    scrape: makeScrape({
      Flow: makeCanteen(label(0), ["Kylling m/ ris", "Kylling m ris", "Fiskesuppe"]),
    }),
  });

  await runWeeklyUpdateService();

  for (const batch of world.cacheWrites) {
    const keys = batch.map((r) => r.cache_key);
    assert.equal(new Set(keys).size, keys.length, `duplicate cache_key in one batch: ${keys}`);
  }
  assert.ok(world.cacheRows.get("kylling m ris"), "the colliding dish is stored once");
  assert.ok(world.cacheRows.get("fiskesuppe"), "and its batch-mate survives");
});

test("a rollover charges a failing dish one attempt per run, not one per week", async () => {
  // Both weeks of a rollover hold nearly the same dishes, because every canteen
  // is seeded into every week's row. Enriching each week independently would
  // send the same dish to the model twice in one run and burn two of its five
  // attempts — halving the budget in exactly the week where brand-new, uncached
  // dishes first appear.
  reset({
    scrape: makeScrape({
      Flow: makeCanteen(label(0), ["Ukjent rett"]),
      Fresh4you: makeCanteen(label(1), ["Ukjent rett"]),
    }),
    silentOrigins: new Set(["Ukjent rett"]),
    silentDescriptions: new Set(["Ukjent rett"]),
  });

  const result = await runWeeklyUpdateService();

  assert.equal(result.weeksWritten.length, 2, "both weeks were written");
  assert.deepEqual(
    world.originsAsked.filter((batch) => batch.length > 0),
    [["Ukjent rett"]],
    "the dish is put to the model exactly once for the whole run"
  );
  assert.equal(world.cacheRows.get("ukjent rett")!.enrich_attempts, 1);
  assert.deepEqual(result.stats.unresolved, ["Ukjent rett"], "and is reported once, not twice");
});

test("a rollover asks about a new dish once and reuses it for the other week", async () => {
  reset({
    scrape: makeScrape({
      Flow: makeCanteen(label(0), ["Fiskesuppe"]),
      Fresh4you: makeCanteen(label(1), ["Fiskesuppe"]),
    }),
  });

  const result = await runWeeklyUpdateService();

  assert.deepEqual(
    world.originsAsked.filter((batch) => batch.length > 0),
    [["Fiskesuppe"]],
    "the second week reads back what the first week cached"
  );
  assert.equal(result.stats.durablyCached, 1);
});
