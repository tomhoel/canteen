import React, { Suspense, use, useCallback, useState } from "react";
import { LazyMotion } from "motion/react";
import { AnimatedGradient } from "@/components/ui/stripe-animated-gradient";
import ErrorBoundary from "@/components/ErrorBoundary";
import HomeClient from "@/components/HomeClient";
import LoadingScreen from "@/components/LoadingScreen";
import MenuError from "@/components/MenuError";
import { useSearch } from "@/lib/useSearch";
import { menuResource } from "@/lib/menu-resource";

/**
 * The app, with the router's job done by React itself.
 *
 * What the route tree used to provide, and what replaces it:
 *
 *   loader + useLoaderData   ->  menuResource() + use()
 *   pendingComponent         ->  <Suspense fallback={<LoadingScreen />}>
 *   errorComponent + reset   ->  <ErrorBoundary> + the epoch below
 *   __root's chrome          ->  rendered here directly
 *
 * The router was configured with `defaultPendingMs: 0` and
 * `defaultPendingMinMs: 0` — show the shell immediately, swap it the instant
 * the data lands. That is exactly Suspense's own behaviour, so the loading
 * feel is unchanged rather than approximated.
 */
const Toaster = React.lazy(() =>
  import("sonner").then((m) => ({ default: m.Toaster }))
);

/**
 * Fetched, not bundled — see `src/lib/motion-features.ts` for why.
 *
 * Declared at module scope rather than inline in the JSX: LazyMotion compares
 * this by identity, and a new arrow function every render would make it
 * reload the features on each one.
 */
const loadMotionFeatures = () =>
  import("@/lib/motion-features").then((mod) => mod.default);

function Menu({ epoch }: { epoch: number }) {
  // Read the week here rather than in App, so a ?day= change re-renders only
  // this subtree and never the gradient. A same-week re-render hits an
  // already-settled promise, which use() returns synchronously — only a ?week=
  // change suspends again, which is precisely what the router expressed as
  // `loaderDeps: ({ search }) => ({ week: search.week })`.
  const { week } = useSearch();
  const {
    weekId,
    menuData,
    dishOrigins,
    dishDescriptions,
    dishShortNames,
    plateImages,
  } = use(menuResource(week, epoch));

  return (
    <HomeClient
      initialMenu={menuData}
      servedWeekId={weekId}
      initialOrigins={dishOrigins}
      initialDescriptions={dishDescriptions}
      initialShortNames={dishShortNames ?? {}}
      plateImages={plateImages ?? {}}
    />
  );
}

export default function App() {
  const [epoch, setEpoch] = useState(0);
  const retry = useCallback(() => setEpoch((e) => e + 1), []);

  return (
    <>
      <AnimatedGradient
        color1="#f0d090"
        color2="#d4a090"
        color3="#f0bfa0"
        color4="#e8d8c4"
      />
      {/* Together these two are the router's `reset`: the key remounts the
          boundary so it drops the error it caught, and the new epoch makes
          menuResource mint a fresh promise rather than replaying the failed
          one. Either alone would leave the retry button inert. */}
      {/* `strict` is the regression guard: it makes a plain `motion.div`
          throw, so the next one added anywhere under here fails loudly in
          development instead of silently pulling the whole 42 KB animation
          runtime back onto the critical path. */}
      <LazyMotion features={loadMotionFeatures} strict>
        <ErrorBoundary
          key={epoch}
          fallback={(error: Error) => (
            <MenuError error={error} onRetry={retry} />
          )}
        >
          <Suspense fallback={<LoadingScreen />}>
            <Menu epoch={epoch} />
          </Suspense>
        </ErrorBoundary>
      </LazyMotion>
      <Suspense fallback={null}>
        <Toaster
          position="top-center"
          richColors
          toastOptions={{
            style: {
              fontFamily: "Outfit, sans-serif",
              borderRadius: "16px",
              boxShadow: "0 12px 32px rgba(60, 30, 0, 0.12)",
            },
          }}
        />
      </Suspense>
    </>
  );
}
