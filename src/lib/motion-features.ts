/**
 * Motion's animation features, on their own so they can be fetched late.
 *
 * `motion.div` bundles the entire animation runtime into whatever chunk
 * imports it — measured here at 42 KB gzipped, 28% of all the JavaScript this
 * app blocks its first paint on, for an app whose one job is to show a menu
 * quickly. `m` is the same component with none of that: the features are
 * handed to it at runtime by `<LazyMotion>`, which is what makes this file a
 * separate `import()` and therefore a separate chunk.
 *
 * `domAnimation`, not `domMax`. The difference between them is layout
 * projection and the `drag` prop, and this app uses neither: the day strip's
 * gesture is hand-written in `useDaySwipe`, which only ever reads touch events
 * and writes a MotionValue.
 *
 * Nothing about the animations themselves changes. Every spring keeps its
 * exact stiffness, damping and mass — this moves where the code that runs them
 * is fetched, not what it does.
 */
export { domAnimation as default } from "motion/react";
