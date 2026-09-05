import test from "node:test";
import assert from "node:assert/strict";
import { matchesCachedShape } from "./redis.service.js";

/**
 * Every read site used to be `if (cached) return cached`, which accepts
 * anything truthy — including an entry written by a previous deploy, missing
 * whatever has been added since. Nothing throws; the caller just behaves as if
 * the field had never been added. That took three deploys to chase on the menu
 * path, where the TTL is ten minutes. `meny` holds three days, `recipe` seven.
 */

interface Sample {
  title: string;
  steps: string[];
  tip?: string;
}
const REQUIRED = ["title", "steps"] as const;

test("a complete entry is a hit", () => {
  assert.equal(matchesCachedShape<Sample>({ title: "Suppe", steps: ["kok"] }, REQUIRED), true);
});

test("an optional field may be absent", () => {
  // The point of listing required fields rather than every field: `tip?` is
  // absent by design, and demanding it would make every entry a miss and
  // re-bill the AI call it exists to avoid.
  const entry = { title: "Suppe", steps: [] };
  assert.equal(matchesCachedShape<Sample>(entry, REQUIRED), true);
});

test("an entry from an older shape is a miss", () => {
  assert.equal(matchesCachedShape<Sample>({ title: "Suppe" }, REQUIRED), false);
  assert.equal(matchesCachedShape<Sample>({ steps: ["kok"] }, REQUIRED), false);
});

test("null and undefined fields are missing, not present", () => {
  assert.equal(matchesCachedShape<Sample>({ title: "Suppe", steps: null }, REQUIRED), false);
  assert.equal(matchesCachedShape<Sample>({ title: undefined, steps: [] }, REQUIRED), false);
});

test("non-objects are misses rather than throws", () => {
  // redis.get returns null on a miss, and a corrupted entry can deserialise to
  // anything at all.
  for (const junk of [null, undefined, "", 0, false, "a string", 42]) {
    assert.equal(matchesCachedShape<Sample>(junk, REQUIRED), false, String(junk));
  }
});

test("an empty required list accepts any object", () => {
  // Not a useful call, but it must not throw — a caller that guards nothing
  // should behave exactly like the old `if (cached)`.
  assert.equal(matchesCachedShape<Sample>({}, []), true);
  assert.equal(matchesCachedShape<Sample>(null, []), false);
});

test("falsy-but-present values still count as present", () => {
  // `0` and `""` are legitimate values — a total price of 0, an empty title.
  // Using truthiness here rather than `!= null` would evict them.
  interface Priced { totalPrice: number; store: string }
  assert.equal(
    matchesCachedShape<Priced>({ totalPrice: 0, store: "" }, ["totalPrice", "store"]),
    true
  );
});
