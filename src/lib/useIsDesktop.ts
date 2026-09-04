import { useEffect, useState } from "react";

/**
 * The app's one breakpoint, as a hook.
 *
 * 769px, matching the `@media (min-width: 769px)` blocks in globals.css. There
 * is one value on purpose: the layout, the sheet's shape, the day bar's
 * position and the card tilt all have to agree about what a desktop is, and
 * they did not — a window dragged narrow used to get the phone layout with the
 * desktop's 3D tilt still running on top of it.
 *
 * Prefer this over a `@media` rule whenever the difference is *whether to
 * render something*, not how it looks. Rendering a node and hiding it with CSS
 * still costs the phone the component, its effects and its listeners; the
 * whole point of the two tiers is that the phone does less work, not that it
 * does the same work invisibly.
 *
 * The initial value is read synchronously so the first render is already
 * correct — initialising to `false` and correcting in an effect guarantees a
 * layout flash on every desktop mount.
 */
const QUERY = "(min-width: 769px)";

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia(QUERY).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    setIsDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return isDesktop;
}
