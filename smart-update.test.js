/**
 * Argument parsing for the manual updater.
 *
 * `--week` is the only argument that can do lasting damage: it is handed
 * straight to runWeeklyUpdateService, which uses it as the primary key of a
 * weekly_menus row and as the override that beats whatever week the canteens
 * themselves advertise. A typo does not fail — it writes this week's food into
 * a row named after the typo, and there is no delete path anywhere in this
 * codebase. The override had also never been exercised end to end since it was
 * refactored; the write-path suite covers the service side, this covers the CLI.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "./smart-update.js";

test("parseArgs - no arguments means today's week, no force", () => {
  assert.deepEqual(parseArgs([]), { force: false, weekId: undefined });
});

test("parseArgs - --force is recognised anywhere in the list", () => {
  assert.equal(parseArgs(["--force"]).force, true);
  assert.equal(parseArgs(["--week", "2026-W34", "--force"]).force, true);
});

test("parseArgs - accepts a well-formed week id", () => {
  assert.deepEqual(parseArgs(["--week", "2026-W34"]), { force: false, weekId: "2026-W34" });
  assert.equal(parseArgs(["--week", "2027-W01"]).weekId, "2027-W01");
  assert.equal(parseArgs(["--week", "2026-W53"]).weekId, "2026-W53");
});

test("parseArgs - rejects a week id that is not one", () => {
  // Every one of these would otherwise become a permanent row key.
  for (const bad of ["34", "2026-W", "2026-W3", "2026-W00", "2026-W54", "W34", "2026-34", "next"]) {
    assert.throws(() => parseArgs(["--week", bad]), /not a week id/, `accepted "${bad}"`);
  }
});

test("parseArgs - rejects --week with nothing after it", () => {
  assert.throws(() => parseArgs(["--week"]), /needs a week id/);
  // The easy mistake: the flag order makes "--force" look like the value.
  assert.throws(() => parseArgs(["--week", "--force"]), /needs a week id/);
});
