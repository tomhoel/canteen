/**
 * Tests for the lunch vote store.
 *
 * These exist because every layer of this feature reported success while doing
 * nothing. The service wrote to `canteen_attendance` — a table that was never
 * created — and supabase-js answers a missing table with `{ data: null, error }`
 * rather than throwing, so a destructure that took only `data` turned three
 * failed round trips into `{ success: true, canteens: {} }`. The endpoint
 * answered 200, the client overwrote its optimistic count with the empty tally,
 * and the vote vanished between one render and the next.
 *
 * So the rule the tests below encode is: a vote that was not stored must throw.
 * An empty tally is a legitimate answer only when nobody has voted yet, and it
 * must never be the way a failure looks.
 *
 * Seam and mocking rules are the same three as menu.service.update.test.ts —
 * one `mock.module` per specifier at top level, every mock reading from a
 * mutable holder, subject imported with a top-level await.
 *
 * Requires --experimental-test-module-mocks; see the `test` script.
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
  /** Rows the table currently holds. */
  rows: VoteRow[];
  /** When set, the vote RPC answers with this error instead of writing. */
  rpcError: string | null;
  /** When set, the history read answers with this error. */
  selectError: string | null;
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  selects: Array<{ table: string; since: string }>;
}

let world: World;

function reset(overrides: Partial<World> = {}) {
  world = {
    rows: [],
    rpcError: null,
    selectError: null,
    rpcCalls: [],
    selects: [],
    ...overrides,
  };

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
}

reset();

function makeSupabaseClient() {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      world.rpcCalls.push({ name, args });
      if (world.rpcError) return Promise.resolve({ data: null, error: { message: world.rpcError } });

      // Mirrors the SQL: increment the row, then return the whole day.
      const date = String(args.p_date);
      const canteen = String(args.p_canteen);
      const existing = world.rows.find((r) => r.vote_date === date && r.canteen_name === canteen);
      if (existing) existing.vote_count += 1;
      else world.rows.push({ vote_date: date, canteen_name: canteen, vote_count: 1 });

      const day = world.rows
        .filter((r) => r.vote_date === date)
        .map(({ canteen_name, vote_count }) => ({ canteen_name, vote_count }));
      return Promise.resolve({ data: day, error: null });
    },

    from(table: string) {
      return {
        select: () => ({
          gte: (_column: string, since: string) => {
            world.selects.push({ table, since });
            const result = world.selectError
              ? { data: null, error: { message: world.selectError } }
              : { data: world.rows.filter((r) => r.vote_date >= since), error: null };
            return {
              order: () => Promise.resolve(result),
            };
          },
        }),
      };
    },
  };
}

mock.module("@supabase/supabase-js", {
  namedExports: {
    createClient: (_url: string, _key: string) => makeSupabaseClient(),
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

test("counting happens in the database, so two simultaneous voters cannot lose one", async () => {
  // The previous implementation read the count, added one in JavaScript and
  // wrote it back: two people voting during the same lunch rush would read the
  // same number and store the same increment. The single RPC leaves the
  // arithmetic to Postgres, which is the only place it can be atomic.
  reset();

  await submitVoteService("Flow");

  assert.equal(world.rpcCalls.length, 1);
  assert.equal(world.rpcCalls[0].name, "cast_attendance_vote");
  assert.deepEqual(world.rpcCalls[0].args, { p_date: today(), p_canteen: "Flow" });
});

test("a vote that could not be stored throws instead of reporting success", async () => {
  // The bug this whole file exists for.
  reset({ rpcError: 'relation "public.canteen_attendance" does not exist' });

  await assert.rejects(
    () => submitVoteService("Flow"),
    /could not be recorded.*does not exist/is,
    "a failed write must not look like a successful one"
  );
});

test("an unconfigured deployment throws rather than silently dropping votes", async () => {
  reset();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;

  await assert.rejects(() => submitVoteService("Flow"), /not configured/i);

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
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
  // The modal is titled "last 2 weeks" and its empty state says 14 days. If the
  // query and the title disagree the bars are simply wrong, and nothing says so.
  reset();

  await getAttendanceHistoryService();

  assert.equal(HISTORY_DAYS, 14);
  const expected = new Date(Date.parse(`${today()}T00:00:00Z`) - 13 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  assert.equal(world.selects[0].since, expected, "13 days back plus today is a 14-day window");
});

test("an empty history is an empty list, not a failure", async () => {
  reset();

  const { entries } = await getAttendanceHistoryService();

  assert.deepEqual(entries, []);
});

test("a failed history read throws instead of rendering an empty leaderboard", async () => {
  // The stub this replaces returned `{ entries: [] }` unconditionally, so a
  // broken read and a quiet fortnight looked identical in the UI.
  reset({ selectError: "connection reset" });

  await assert.rejects(() => getAttendanceHistoryService(), /connection reset/);
});

/** Today in Europe/Oslo, the key the votes are filed under. */
function today(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Oslo" });
}
