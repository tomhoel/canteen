import { useEffect, useRef } from "react";

/**
 * Whether the platform routes close requests through `CloseWatcher`.
 *
 * A close request is not only the Android back gesture — it is Escape too. So
 * where this is true, the watcher already delivers Escape and a separate keydown
 * listener would run the same chain a second time. Today that is harmless
 * because both callbacks read the same state and land on the same branch, but it
 * is only harmless by accident: if the two ever landed in different ticks, one
 * Escape would close two layers. Callers use this to hand Escape to the watcher
 * outright rather than rely on that.
 */
export const CLOSE_REQUESTS_HANDLED_BY_PLATFORM =
  typeof window !== "undefined" &&
  typeof (window as unknown as { CloseWatcher?: unknown }).CloseWatcher === "function";

/**
 * Routes the platform's "close request" — the Android back gesture, chiefly — to
 * a handler, so back closes the topmost overlay instead of leaving the app.
 *
 * WHY THIS EXISTS
 *
 * `public/manifest.json` declares `display: "standalone"`, so once the app is on
 * the home screen there is no browser chrome and the system back gesture is the
 * ONLY back affordance a user has. Nothing in the app touched history or close
 * requests, so back exited the whole app from inside an open sheet — the user
 * loses their place to dismiss a dialog.
 *
 * WHY NOT `history.pushState`
 *
 * The usual trick is to push a dummy history entry when an overlay opens and pop
 * it on back. `CloseWatcher` is the API that was specified to replace exactly
 * that pattern, and pushState would collide with `useSearch.ts`, which drives
 * `?day=` through `replaceState` on purpose. A pushed entry per overlay would
 * also pile up and make back feel broken in the other direction.
 *
 * SUPPORT
 *
 * Chrome and Chrome Android 126+ (it shipped in 120, was pulled over a `<dialog>`
 * interaction, and came back in 126). Firefox 149. Safari has it in preview only,
 * so on iOS this is a no-op and the existing Escape handling remains the way an
 * overlay is dismissed from a keyboard. There is no fallback path by design: the
 * behaviour without a CloseWatcher is exactly what the app does today.
 *
 * RE-ARMING
 *
 * A CloseWatcher is spent once it fires. Pass a `depth` that changes whenever the
 * overlay stack changes and this re-arms for the next layer down, so back walks
 * the stack one press at a time. At depth 0 no watcher exists at all, which is
 * what lets back leave the app when nothing is open.
 */
export function useCloseRequest(depth: number, onCloseRequest: () => void): void {
  // The handler is read at fire time, not capture time, so a re-render with a
  // new closure does not require tearing down and re-arming the watcher.
  const handler = useRef(onCloseRequest);
  useEffect(() => {
    handler.current = onCloseRequest;
  });

  useEffect(() => {
    if (depth <= 0) return;
    const Watcher = (
      window as unknown as { CloseWatcher?: new () => EventTarget & { destroy: () => void } }
    ).CloseWatcher;
    if (typeof Watcher !== "function") return;

    const watcher = new Watcher();
    const onClose = () => handler.current();
    watcher.addEventListener("close", onClose);
    return () => {
      watcher.removeEventListener("close", onClose);
      watcher.destroy();
    };
  }, [depth]);
}
