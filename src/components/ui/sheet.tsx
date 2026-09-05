"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useDrag } from "@use-gesture/react";
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
 * - Drag-to-dismiss via `@use-gesture/react` writes to `--sheet-drag` CSS custom property
 *   without per-frame React state re-renders.
 * - Inert shell while open so touches & focus behind the sheet cannot leak.
 * - Keyboard-aware lift via `useKeyboardInset`.
 */

const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const DUR_MS = 400;
const DISMISS_FRACTION = 0.25;
const DISMISS_VELOCITY = 0.5;

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

  // Drag to dismiss
  const dragRef = React.useRef({ atTop: false, engaged: false });

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
      const h = panel.getBoundingClientRect().height || 1;
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

  useDrag(
    ({ first, last, movement: [, my], velocity: [, vy], event }) => {
      const panel = panelRef.current;
      if (!panel) return;

      if (first) {
        dragRef.current.atTop = scrollableIsAtTop(event.target);
        dragRef.current.engaged = false;
        return;
      }

      if (!dragRef.current.engaged) {
        if (last) return;
        if (!shouldEngage({ ...dragRef.current, my })) return;
        dragRef.current.engaged = true;
        panel.style.transition = "none";
      }

      if (last) {
        endDrag(
          shouldDismiss({
            my,
            vy,
            height: panel.getBoundingClientRect().height,
            fraction: DISMISS_FRACTION,
            velocity: DISMISS_VELOCITY,
          })
        );
        dragRef.current.engaged = false;
        return;
      }

      if (event.cancelable) event.preventDefault();
      setDrag(Math.max(0, my));
    },
    {
      target: panelRef,
      axis: "y",
      filterTaps: true,
      eventOptions: { passive: false },
      // Drag-to-dismiss is a touch affordance. On a desktop the panel is a
      // centred card with nowhere to be flung, and a click-drag on it would
      // just smear it off the bottom of the screen.
      enabled: !isDesktop,
    }
  );

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
        pointerEvents: "auto",
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
        onTransitionEnd={(e) => {
          if (!open && e.target === panelRef.current && e.propertyName === "transform") {
            setRendered(false);
          }
        }}
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
          transition,
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
