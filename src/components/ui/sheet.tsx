"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { shouldDismiss, shouldEngage } from "@/lib/sheet-drag";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { useIsDesktop } from "@/lib/useIsDesktop";
import { useShellInert } from "@/lib/useShellInert";

/**
 * Bottom Sheet — animated with PURE CSS TRANSFORMS (translateY + opacity) so
 * open/close and dismiss run directly on the GPU compositor at full 120Hz refresh,
 * NOT on the main thread.
 *
 * Ported from sister app `mutu-web`:
 * - Vaul/iOS spring curve: cubic-bezier(0.32, 0.72, 0, 1), 400ms.
 * - Portalled to document.body so it escapes any parent transforms/stacking contexts.
 * - Drag-to-dismiss writes to the `--sheet-drag` custom property from raw touch
 *   listeners, with no per-frame React state re-render and no gesture library.
 * - Inert shell while open so touches & focus behind the sheet cannot leak.
 * - Keyboard-aware lift via `useKeyboardInset`.
 */

const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const DUR_MS = 400;
const DISMISS_FRACTION = 0.25;
const DISMISS_VELOCITY = 0.5;

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type SheetContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  panel: React.RefObject<HTMLDivElement | null>;
};

const SheetContext = React.createContext<SheetContextValue | null>(null);


export function useSheet(): SheetContextValue {
  const ctx = React.useContext(SheetContext);
  if (!ctx) throw new Error("Sheet subcomponents must be used within <Sheet>");
  return ctx;
}

export function Sheet({
  open: openProp,
  onOpenChange,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const [internal, setInternal] = React.useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internal;

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setInternal(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange]
  );

  const panel = React.useRef<HTMLDivElement>(null);
  const value = React.useMemo(() => ({ open, setOpen, panel }), [open, setOpen]);

  return <SheetContext.Provider value={value}>{children}</SheetContext.Provider>;
}

export interface SheetContentProps {
  children: React.ReactNode;
  className?: string;
  showCloseButton?: boolean;
  showHandle?: boolean;
  "aria-label"?: string;
  onClose?: () => void;
  detent?: "content" | "medium";
}

export function SheetContent({
  children,
  className = "",
  showCloseButton = true,
  showHandle = true,
  "aria-label": ariaLabel,
  onClose,
  detent = "content",
}: SheetContentProps) {
  const { open, setOpen, panel: panelRef } = useSheet();
  const keyboardInset = useKeyboardInset(open);
  const isDesktop = useIsDesktop();

  const [rendered, setRendered] = React.useState(open);
  const [shown, setShown] = React.useState(false);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const opener = React.useRef<HTMLElement | null>(null);

  const handleClose = React.useCallback(() => {
    setOpen(false);
    onClose?.();
  }, [setOpen, onClose]);

  // Two-phase mount / unmount
  React.useEffect(() => {
    if (open) {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      setRendered(true);
      return;
    }
    setShown(false);
    // Under `prefers-reduced-motion` globals.css applies `* { transition: none
    // !important }`, which beats even an inline style. No transition means no
    // `transitionend`, so the timer below was the ONLY unmount path for those
    // users — leaving a full-screen fixed layer over the app for 460ms after
    // every single close. Nothing is animating; unmount now.
    if (prefersReducedMotion()) {
      setRendered(false);
      return;
    }
    // The timer is the ONLY unmount path, deliberately.
    //
    // There used to be an `onTransitionEnd` on the panel that unmounted as soon
    // as a `transform` transition finished, with the timer as a backstop. It was
    // a race. A `transitionend` is delivered on the event loop, and under load
    // that delivery lags the transition itself — measured here at up to 180ms.
    // Close the sheet inside that window (tap a card, then tap outside while it
    // is still sliding up) and the ENTRANCE's queued `transitionend` arrives
    // when `open` is already false, satisfies the guard, and unmounts the panel
    // instantly. Nothing in the event distinguishes it from the exit's own.
    // Measured: this made the desktop close vanish instantly 4 times in 6.
    //
    // A fixed timer cannot be confused by a stale event. It costs 60ms of an
    // already-invisible layer, and that layer is now `pointer-events: none`.
    closeTimer.current = setTimeout(() => setRendered(false), DUR_MS + 60);
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [open]);

  // Entrance: force style recalc at closed position (translateY(100%)) so transition ALWAYS runs
  React.useLayoutEffect(() => {
    if (!open || !rendered) return;
    const el = panelRef.current;
    if (el) void el.offsetHeight;
    setShown(true);
  }, [open, rendered, panelRef]);

  // Inert background — shared with every other overlay, and refcounted so a
  // recipe modal opening over this sheet does not release it on unmount.
  useShellInert(rendered);

  // Focus management
  React.useEffect(() => {
    if (!shown) return;
    opener.current ??= document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus({ preventScroll: true });
  }, [shown, panelRef]);

  React.useEffect(() => {
    if (rendered) return;
    const back = opener.current;
    opener.current = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
  }, [rendered]);

  // Escape key listener
  React.useEffect(() => {
    if (!rendered) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [rendered, handleClose]);

  // Drag to dismiss.
  //
  // Hand-rolled on raw touch events, deliberately. `@use-gesture/react` did this
  // and cost 6,489 bytes gzipped — 65% of the chunk that downloads and parses at
  // the exact moment the user taps a card and is waiting for something to
  // happen. It had exactly one consumer in the repo: these forty lines. It also
  // bound its listeners through `useEffect` with no dependency array, so every
  // render of this component tore down and re-registered them, and it derived
  // release velocity from a sample up to 32ms stale.
  //
  // `height` is measured once, when the gesture starts. It used to be read on
  // every move — a `getBoundingClientRect()` between two style writes, forcing a
  // layout flush on the frame that can least afford one. The panel cannot change
  // height while a finger is dragging it.
  const dragRef = React.useRef({
    atTop: false,
    engaged: false,
    height: 0,
    startY: 0,
    lastY: 0,
    lastT: 0,
    vy: 0,
    dy: 0,
  });

  const scrollableIsAtTop = (from: EventTarget | null): boolean => {
    let el = from as HTMLElement | null;
    while (el && el !== panelRef.current) {
      if (el.scrollHeight > el.clientHeight + 1) {
        const style = getComputedStyle(el);
        if (/(auto|scroll)/.test(style.overflowY)) return el.scrollTop <= 0;
      }
      el = el.parentElement;
    }
    return true;
  };

  const setDrag = (px: number) => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.style.setProperty("--sheet-drag", `${px}px`);
    const backdrop = panel.previousElementSibling as HTMLElement | null;
    if (backdrop) {
      const h = dragRef.current.height || 1;
      backdrop.style.opacity = String(Math.max(0, 1 - px / h));
    }
  };

  const endDrag = (dismiss: boolean) => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.style.transition = "";
    const backdrop = panel.previousElementSibling as HTMLElement | null;
    if (backdrop) backdrop.style.opacity = "";
    panel.style.setProperty("--sheet-drag", "0px");
    if (dismiss) {
      handleClose();
    }
  };

  // Everything the listeners need lives in `dragRef` and in refs above, so this
  // effect depends only on whether there is a panel to attach to and whether
  // drag applies at all. That is the point: re-registering a non-passive
  // listener mid-gesture drops the gesture, which is what the old binding did on
  // every render.
  const dragHandlers = React.useRef<{ dismiss: (d: boolean) => void; drag: (px: number) => void; atTop: (t: EventTarget | null) => boolean }>({
    dismiss: endDrag,
    drag: setDrag,
    atTop: scrollableIsAtTop,
  });
  dragHandlers.current = { dismiss: endDrag, drag: setDrag, atTop: scrollableIsAtTop };

  React.useEffect(() => {
    // Drag-to-dismiss is a touch affordance. On a desktop the panel is a centred
    // card with nowhere to be flung, and a click-drag would smear it off the
    // bottom of the screen.
    if (!rendered || isDesktop) return;
    const panel = panelRef.current;
    if (!panel) return;

    const d = dragRef.current;

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      d.atTop = dragHandlers.current.atTop(e.target);
      d.engaged = false;
      d.height = panel.getBoundingClientRect().height;
      d.startY = t.clientY;
      d.lastY = t.clientY;
      d.lastT = e.timeStamp;
      d.vy = 0;
      d.dy = 0;
    };

    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      const my = t.clientY - d.startY;

      if (!d.engaged) {
        if (!shouldEngage({ atTop: d.atTop, engaged: false, my })) {
          // Not ours yet. Keep the sampler warm so the first engaged frame has a
          // real baseline instead of the touchstart position.
          d.lastY = t.clientY;
          d.lastT = e.timeStamp;
          return;
        }
        d.engaged = true;
        panel.style.transition = "none";
      }

      // px/ms, the same unit @use-gesture reported, so DISMISS_VELOCITY keeps
      // the value it was tuned to. Taken from the most recent pair of moves —
      // a flick is decided by how the gesture ENDS, not by its average.
      const dt = e.timeStamp - d.lastT;
      if (dt > 0) {
        const step = t.clientY - d.lastY;
        d.vy = Math.abs(step) / dt;
        d.dy = Math.sign(step);
        d.lastY = t.clientY;
        d.lastT = e.timeStamp;
      }

      if (e.cancelable) e.preventDefault();
      dragHandlers.current.drag(Math.max(0, my));
    };

    const onEnd = (e: TouchEvent) => {
      if (!d.engaged) return;
      d.engaged = false;
      const t = e.changedTouches[0];
      const my = t ? t.clientY - d.startY : 0;
      // A finger that came to rest before lifting is not a flick, however fast
      // it was travelling earlier.
      const stale = e.timeStamp - d.lastT > 100;
      dragHandlers.current.dismiss(
        shouldDismiss({
          my,
          vy: stale ? 0 : d.vy,
          dy: stale ? 0 : d.dy,
          height: d.height,
          fraction: DISMISS_FRACTION,
          velocity: DISMISS_VELOCITY,
        })
      );
    };

    const onCancel = () => {
      if (!d.engaged) return;
      d.engaged = false;
      dragHandlers.current.dismiss(false);
    };

    panel.addEventListener("touchstart", onStart, { passive: true });
    panel.addEventListener("touchmove", onMove, { passive: false });
    panel.addEventListener("touchend", onEnd, { passive: true });
    panel.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      panel.removeEventListener("touchstart", onStart);
      panel.removeEventListener("touchmove", onMove);
      panel.removeEventListener("touchend", onEnd);
      panel.removeEventListener("touchcancel", onCancel);
    };
  }, [rendered, isDesktop, panelRef]);

  if (typeof document === "undefined" || !rendered) return null;

  const transition = `transform ${DUR_MS}ms ${EASE}, opacity ${DUR_MS}ms ${EASE}`;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        // The sheet is the topmost layer, matching --z-sheet in globals.css.
        // It is inline because this element is portalled outside .app-wrapper
        // and builds its own positioning; the stylesheet cannot reach it.
        zIndex: 2100,
        display: "flex",
        flexDirection: "column",
        // Bottom sheet on a phone, centred card on a desktop — the treatment
        // the stylesheet used to describe before this component took the
        // positioning inline.
        justifyContent: isDesktop ? "center" : "flex-end",
        alignItems: "center",
        // The layer stays mounted for the whole close animation. Left at
        // "auto" it went on covering the screen at zIndex 2100 while invisible,
        // so a tap in that window hit a dead backdrop — and ActionSheet closes
        // itself and THEN opens the recipe modal, which lands at zIndex 1500,
        // underneath it.
        pointerEvents: shown ? "auto" : "none",
      }}
    >
      {/* Backdrop — GPU opacity compositor */}
      <div
        role="presentation"
        aria-hidden="true"
        onClick={handleClose}
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "rgba(26, 21, 17, 0.55)",
          opacity: shown ? 1 : 0,
          transition,
          willChange: "opacity",
        }}
      />

      {/* Sheet Panel — pure GPU translateY transform */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        className={`native-sheet-panel ${className}`}
        style={{
          position: "relative",
          width: "100%",
          maxWidth: isDesktop ? 380 : 440,
          backgroundColor: "var(--card-white)",
          // A phone sheet is anchored to the bottom edge, so only its top
          // corners are round and the shadow is cast upward. A desktop card
          // floats, so it is round all the way and casts downward.
          borderRadius: isDesktop ? 24 : undefined,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          boxShadow: isDesktop
            ? "0 8px 30px rgba(60, 30, 0, 0.10), 0 30px 80px rgba(60, 30, 0, 0.15)"
            : "0 100px 0 0 var(--card-white), 0 -4px 24px rgba(60, 30, 0, 0.12), 0 -16px 60px rgba(60, 30, 0, 0.16)",
          maxHeight: isDesktop
            ? "min(80dvh, 720px)"
            : detent === "medium"
              ? `min(62dvh, calc(100dvh - env(safe-area-inset-top, 0px) - 34px - ${keyboardInset}px))`
              : `calc(100dvh - env(safe-area-inset-top, 0px) - 34px - ${keyboardInset}px)`,
          // Sliding up from the bottom edge is the phone gesture. A centred
          // card has no edge to come from, so it scales in on the spot.
          transform: isDesktop
            ? shown
              ? "scale(1)"
              : "scale(0.96)"
            : shown
              ? `translateY(calc(${keyboardInset ? `-${keyboardInset}px` : "0px"} + var(--sheet-drag, 0px)))`
              : "translateY(100%)",
          opacity: isDesktop ? (shown ? 1 : 0) : 1,
          // NO `transition` here — it lives in the `.native-sheet-panel` rule in
          // globals.css, and it has to.
          //
          // `endDrag` clears the inline transition with `style.transition = ""`
          // when a gesture ends. React will not put it back: it only writes an
          // inline style when the value it holds CHANGED, and this string is a
          // module constant, so from React's point of view nothing happened. With
          // no stylesheet rule underneath, the panel was left with no transition
          // at all from the first drag onward — measured in a browser as
          // `computed: "all / 0s"`, and a close that teleported to 443px in a
          // single frame instead of sliding. A class rule survives the clear.
          willChange: "transform, opacity",
          outline: "none",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          // `none`, not `pan-y`. Declaring pan-y tells the browser it owns
          // vertical panning here, so on a real touchscreen it claims the
          // gesture the moment a drag turns downward and fires pointercancel —
          // which ends the drag-to-dismiss instantly instead of letting the
          // sheet follow the finger. Measured: this panel is 344px tall, does
          // not scroll, and has no scrollable descendant, so there was never
          // anything for the browser to pan. If a sheet ever does need to
          // scroll, the scrollable child should declare pan-y for itself —
          // scrollableIsAtTop above already exists to hand the gesture back.
          touchAction: "none",
        }}
      >
        {showHandle && !isDesktop && (
          <div
            style={{
              position: "absolute",
              top: 10,
              left: "50%",
              transform: "translateX(-50%)",
              width: 36,
              height: 4,
              borderRadius: 2,
              backgroundColor: "rgba(255, 255, 255, 0.6)",
              boxShadow: "0 1px 3px rgba(0, 0, 0, 0.15)",
              zIndex: 10,
              pointerEvents: "none",
            }}
          />
        )}

        {showCloseButton && (
          <button
            type="button"
            onClick={handleClose}
            aria-label="Lukk"
            className="action-sheet-close"
            style={{
              position: "absolute",
              top: 10,
              right: 12,
              zIndex: 10,
            }}
          >
            <X size={16} strokeWidth={2.5} />
          </button>
        )}

        {children}
      </div>
    </div>,
    document.body
  );
}
