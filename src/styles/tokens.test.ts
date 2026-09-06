import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/**
 * The contrast gate for the design system.
 *
 * These values were proposed by design-audit agents, and this session had
 * already caught two of their sibling proposals being wrong — a blanket 11px
 * type floor that breaks the dvh layout, and a `min-width` that did not fit its
 * container. So nothing is adopted on trust: every ink is checked here against
 * every ground it actually lands on, with WCAG 2.1 luminance computed from
 * first principles.
 *
 * It reads the real stylesheet rather than a copy of the values. A test that
 * asserts against its own hardcoded palette proves nothing about what ships.
 */

const CSS = fs.readFileSync(new URL("./globals.css", import.meta.url), "utf8");

/** Read a custom property out of the first `:root` block. */
function token(name: string): string {
  const root = CSS.slice(CSS.indexOf(":root {"));
  // `(?:^|[\s;])` rather than a leading newline: the spacing and radius ramps
  // are declared several per line, which is how a scale should read.
  // The trailing `:` makes `--sp-1` unable to match `--sp-12`.
  const m = root.match(new RegExp(`(?:^|[\\s;])${name}:\\s*([^;]+);`));
  assert.ok(m, `${name} is not declared in :root`);
  return m![1].trim();
}

const hex = (h: string): [number, number, number] => {
  const s = h.replace("#", "");
  const n = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)) as [number, number, number];
};
const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const lum = (c: [number, number, number]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const rgb = (c: string | [number, number, number]) => (typeof c === "string" ? hex(c) : c);
const ratio = (fg: string | [number, number, number], bg: string | [number, number, number]) => {
  const a = lum(rgb(fg)) + 0.05;
  const b = lum(rgb(bg)) + 0.05;
  return Math.round((Math.max(a, b) / Math.min(a, b)) * 100) / 100;
};
/** Composite `fg` at `alpha` over opaque `bg` — what the eye actually receives. */
const over = (fg: string, bg: string, alpha: number): [number, number, number] => {
  const f = hex(fg), b = hex(bg);
  return f.map((c, i) => Math.round(c * alpha + b[i] * (1 - alpha))) as [number, number, number];
};

/** The four opaque grounds text lands on in this app. */
const GROUND = { card: "#ffffff", cream: "#f5f0e8", warm: "#ede7db", stale: "#f7f7f7" };
const TEXT = 4.5;
const UI = 3;

const atLeast = (fg: string | [number, number, number], bg: string | [number, number, number], min: number, what: string) => {
  const v = ratio(fg, bg);
  assert.ok(v >= min, `${what}: ${v}:1, needs ${min}:1`);
};

test("every text ink clears AA on all four grounds", () => {
  for (const name of ["--text-primary", "--text-secondary", "--text-muted"]) {
    for (const [g, bg] of Object.entries(GROUND)) {
      atLeast(token(name), bg, TEXT, `${name} on ${g}`);
    }
  }
});

test("--text-muted is no longer the 2.84:1 value it shipped as", () => {
  // Guards the specific regression: someone "restoring the hierarchy" by
  // lightening it back. Muted is no longer a distinct weight — anything
  // clearing 4.5:1 on cream lands within ~4 L* of secondary. The distinction
  // now comes from size, weight and case.
  assert.notEqual(token("--text-muted").toLowerCase(), "#a09890");
});

test("orange separates its decorative role from its text role", () => {
  const fill = token("--accent-orange");
  const ink = token("--accent-orange-ink");

  // The decorative value is allowed to be light — but only for non-text.
  atLeast(fill, GROUND.card, UI, "--accent-orange as a fill on card");
  atLeast(fill, GROUND.cream, UI, "--accent-orange as a fill on cream");

  // ...and must NOT be good enough for text, or the split has no meaning and
  // someone will use it for text again.
  assert.ok(
    ratio(fill, GROUND.card) < TEXT,
    "--accent-orange now passes as text; the ink/fill split is no longer meaningful"
  );

  for (const [g, bg] of Object.entries(GROUND)) atLeast(ink, bg, TEXT, `--accent-orange-ink on ${g}`);
  // The two tinted grounds it also lands on.
  atLeast(ink, "#fff4e8", TEXT, "--accent-orange-ink on the availability-pill fill");
  atLeast(ink, "#ffe4c4", TEXT, "--accent-orange-ink on the desktop day-bar peach");
});

test("white text on an orange surface uses the ink, not the fill", () => {
  // The case the design brief left open. `.week-tab.active` shipped white on
  // --accent-orange at 3.52:1; the recipe buttons do the same on hover.
  atLeast("#ffffff", token("--accent-orange-ink"), TEXT, "white on --accent-orange-ink");
  assert.ok(
    ratio("#ffffff", token("--accent-orange")) < TEXT,
    "white now passes on --accent-orange — re-check why the ink exists"
  );
  assert.ok(
    !/background:\s*#c8741a/.test(fs.readFileSync(new URL("./week-overview.css", import.meta.url), "utf8")
      .split(".week-tab.active")[1]?.slice(0, 200) ?? ""),
    ".week-tab.active is back on the decorative orange with white text on it"
  );
});

test("--accent-green clears AA and the raw literals are gone", () => {
  atLeast(token("--accent-green"), GROUND.card, TEXT, "--accent-green on card");
  atLeast(token("--accent-green"), GROUND.cream, TEXT, "--accent-green on cream");
  // #34c759 is 2.22:1 — it bypassed the token in four places.
  assert.ok(ratio("#34c759", GROUND.card) < TEXT, "sanity: #34c759 is the failing value");
});

test("opacity is not what makes any of these inks quiet", () => {
  // Each of these shipped as an AA failure that a computed-style audit reads as
  // a pass, because the audit sees the token and the eye sees the composite.
  const wasFailing: Array<[string, string, string, number]> = [
    [".dish-description", "#6b6158", GROUND.card, 0.75],
    [".info-btn", "#a09890", GROUND.cream, 0.55],
    [".leaderboard-dot-date", "#a09890", GROUND.card, 0.7],
    [".outdated .canteen-name", "#c8741a", GROUND.card, 0.48],
  ];
  for (const [what, ink, bg, alpha] of wasFailing) {
    assert.ok(ratio(over(ink, bg, alpha), bg) < TEXT, `sanity: ${what} was a real failure`);
  }
  // At full strength, on the corrected inks, all four clear.
  atLeast(token("--text-secondary"), GROUND.card, TEXT, ".dish-description at full opacity");
  atLeast(token("--text-secondary"), GROUND.cream, TEXT, ".info-btn at full opacity");
  atLeast(token("--accent-orange-ink"), GROUND.card, TEXT, ".outdated .canteen-name on ink");
});

test("the type scale is complete and monotonic in all three columns", () => {
  const ROLES = ["--fs-label", "--fs-meta", "--fs-body", "--fs-title", "--fs-hero"];
  for (const r of ROLES) assert.ok(token(r), `${r} missing from the base column`);

  // Pull the two breakpoint blocks and read each column out of them.
  const column = (query: string) => {
    const i = CSS.indexOf(query);
    assert.ok(i > -1, `no ${query} block`);
    const block = CSS.slice(i, i + 900);
    return ROLES.map((r) => {
      const m = block.match(new RegExp(`${r}:\\s*([^;]+);`));
      assert.ok(m, `${r} missing from ${query}`);
      // A clamp's effective size for ordering is its ceiling.
      const nums = m![1].match(/[\d.]+px/g) ?? [];
      return parseFloat(nums[nums.length - 1]);
    });
  };
  const base = ROLES.map((r) => parseFloat(token(r)));
  for (const [name, col] of [
    ["base", base],
    ["mobile", column("@media (max-width: 768px)")],
    ["desktop", column("@media (min-width: 1101px)")],
  ] as Array<[string, number[]]>) {
    for (let i = 1; i < col.length; i++) {
      assert.ok(col[i] >= col[i - 1], `${name} column is not monotonic at ${ROLES[i]}: ${col.join(", ")}`);
    }
  }
});

test("mobile type stays on dvh clamps", () => {
  // The 30 dvh clamps are what fit three cards in an 844px viewport with no
  // scroll. A flat-px mobile scale was proposed twice by the audit and is the
  // one change that would break the app's core layout on real phones.
  const i = CSS.indexOf("@media (max-width: 768px)");
  const block = CSS.slice(i, i + 900);
  for (const r of ["--fs-label", "--fs-meta", "--fs-body", "--fs-title"]) {
    const m = block.match(new RegExp(`${r}:\\s*([^;]+);`));
    assert.match(m![1], /clamp\(.*dvh.*\)/, `${r} must stay a dvh clamp on mobile`);
  }
});

test("the scales exist and the identity radius is 24px", () => {
  for (const t of ["--sp-1", "--sp-2", "--sp-4", "--sp-6", "--e-1", "--e-4", "--dur-fast", "--dur-slow"]) {
    assert.ok(token(t), `${t} missing`);
  }
  assert.equal(token("--r-lg"), "24px", "the card radius is the app's identity; do not drift it");
  // Elevation is warm, never neutral black.
  for (const e of ["--e-1", "--e-2", "--e-3", "--e-4"]) {
    assert.match(token(e), /rgba\(60, 30, 0/, `${e} must use the warm shadow family`);
  }
});
