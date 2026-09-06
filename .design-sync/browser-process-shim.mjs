// Bundled into _ds_bundle.js ahead of the components, via cfg.extraEntries.
//
// Two modules in this app's graph read `process.env` at module scope:
//
//   src/lib/constants.ts   process.env.NEXT_PUBLIC_SUPABASE_URL
//   @tanstack/react-start  process.env.TSS_INLINE_CSS_ENABLED
//
// In the real app that is fine — Vite statically replaces those expressions at
// build time, and the shipped bundle contains no bare `process` at all. The
// design-system bundle is built by esbuild, which does not, so evaluating the
// module threw `ReferenceError: process is not defined` before `window.Canteen`
// was ever assigned. Every component then failed the export gate and every card
// fell back to its floor render.
//
// An EMPTY env is deliberate, not a shortcut. Both reads have a fallback
// (`constants.ts` falls through to the literal Supabase URL, TanStack to a
// falsy default), so undefined is the correct value here — and this file ships
// inside the bundle, so putting real environment values in it would publish
// them to everyone who can open the design system.
//
// cfg.extraEntries emits its specifiers before the main entry in the generated
// `.bundle-entry.mjs`, so this runs first. That ordering is what makes it work.
if (typeof globalThis.process === "undefined") {
  globalThis.process = { env: {} };
} else if (!globalThis.process.env) {
  globalThis.process.env = {};
}

export {};
