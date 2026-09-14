/**
 * Tests for the lunch vote store.
 *
 * Backed by Upstash Redis hashes:
 * - Voting uses atomic HINCRBY
 * - History uses a pipeline across recent dates
 * - A vote that was not stored must throw
 */
import test, { mock } from "node:test";
import assert from "node:assert/strict";

interface VoteRow {
  vote_date: string;
  canteen_name: string;
  vote_count: number;
}

/** Everything a test can steer, and everything it can observe afterwards. */
interface World {
  rows: VoteRow[];
  writeError: string | null;
  readError: string | null;
  incrCalls: Array<{ key: string; field: string; increment: number }>;
  pipelineCalls: string[];
  redisConfigured: boolean;
}

let world: World;

function reset(overrides: Partial<World> = {}) {
  world = {
    rows: [],
    writeError: null,
    readError: null,
    incrCalls: [],
    pipelineCalls: [],
    redisConfigured: true,
    ...overrides,
  };

  process.env.UPSTASH_REDIS_REST_URL = "https://example-redis.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "example-token";
}

reset();

function makeRedisClient() {
  return {
    async hincrby(key: string, field: string, increment: number) {
      world.incrCalls.push({ key, field, increment });
      if (world.writeError) throw new Error(world.writeError);

      const date = key.replace(/^attendance:/, "");
      const existing = world.rows.find((r) => r.vote_date === date && r.canteen_name === field);
      if (existing) existing.vote_count += increment;
      else world.rows.push({ vote_date: date, canteen_name: field, vote_count: increment });
      return 1;
    },

    async hgetall(key: string) {
      if (world.readError) throw new Error(world.readError);
      const date = key.replace(/^attendance:/, "");
      const dayRows = world.rows.filter((r) => r.vote_date === date);
      if (dayRows.length === 0) return null;
      const result: Record<string, number> = {};
      for (const r of dayRows) result[r.canteen_name] = r.vote_count;
      return result;
    },

    pipeline() {
      const ops: string[] = [];
      return {
        hgetall(key: string) {
          ops.push(key);
          world.pipelineCalls.push(key);
          return this;
        },
        async exec() {
          if (world.readError) throw new Error(world.readError);
          return ops.map((key) => {
            const date = key.replace(/^attendance:/, "");
            const dayRows = world.rows.filter((r) => r.vote_date === date);
            if (dayRows.length === 0) return null;
            const res: Record<string, number> = {};
            for (const r of dayRows) res[r.canteen_name] = r.vote_count;
            return res;
          });
        },
      };
    },
  };
}

mock.module("./redis.service.js", {
  namedExports: {
    getRedis: () => (world.redisConfigured ? makeRedisClient() : null),
  },
});

const { submitVoteService, getAttendanceHistoryService, HISTORY_DAYS } = await import(
  "./attendance.service.js"
);

// ── Casting a vote ────────────────────────────────────────────────────────

test("a vote comes back as the whole day's tally, not just the voter's own", async () => {
  reset({ rows: [{ vote_date: today(), canteen_name: "Flow", vote_count: 2 }] });

  const result = await submitVoteService("Fresh4you");

  assert.equal(result.success, true);
  assert.deepEqual(result.canteens, { Flow: 2, Fresh4you: 1 });
});

test("counting happens atomically in Redis HINCRBY", async () => {
  reset();

  await submitVoteService("Flow");

  assert.equal(world.incrCalls.length, 1);
  assert.deepEqual(world.incrCalls[0], {
    key: `attendance:${today()}`,
    field: "Flow",
    increment: 1,
  });
});

test("a vote that could not be stored throws instead of reporting success", async () => {
  reset({ writeError: 'Connection closed' });

  await assert.rejects(
    () => submitVoteService("Flow"),
    /could not be recorded.*Connection closed/is,
    "a failed write must not look like a successful one"
  );
});

test("an unconfigured deployment throws rather than silently dropping votes", async () => {
  reset({ redisConfigured: false });

  await assert.rejects(() => submitVoteService("Flow"), /not configured/i);
});

// ── Reading the history ───────────────────────────────────────────────────

test("history groups the flat rows into one entry per day, newest first", async () => {
  const day1 = today();
  const day2 = new Date(Date.parse(`${day1}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  reset({
    rows: [
      { vote_date: day2, canteen_name: "Flow", vote_count: 3 },
      { vote_date: day2, canteen_name: "Fresh4you", vote_count: 1 },
      { vote_date: day1, canteen_name: "Flow", vote_count: 2 },
    ],
  });

  const { entries } = await getAttendanceHistoryService();

  assert.deepEqual(entries, [
    { date: day1, canteens: { Flow: 2 } },
    { date: day2, canteens: { Flow: 3, Fresh4you: 1 } },
  ]);
});

test("history asks for exactly the window the leaderboard renders", async () => {
  reset();

  await getAttendanceHistoryService();

  assert.equal(HISTORY_DAYS, 14);
  assert.equal(world.pipelineCalls.length, 14);
  const expectedOldest = `attendance:${new Date(Date.parse(`${today()}T00:00:00Z`) - 13 * 86_400_000)
    .toISOString()
    .slice(0, 10)}`;
  assert.equal(world.pipelineCalls[13], expectedOldest, "13 days back plus today is a 14-day window");
});

test("an empty history is an empty list, not a failure", async () => {
  reset();

  const { entries } = await getAttendanceHistoryService();

  assert.deepEqual(entries, []);
});

test("a failed history read throws instead of rendering an empty leaderboard", async () => {
  reset({ readError: "connection reset" });

  await assert.rejects(() => getAttendanceHistoryService(), /connection reset/);
});

/** Today in Europe/Oslo, the key the votes are filed under. */
function today(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Oslo" });
}
