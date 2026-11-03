import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import type { CanteenDayItem } from "@/lib/types";
import { cardPlate, prefersReducedMotion } from "@/lib/plate-flight";

interface LightboxProps {
  isOpen: boolean;
  currentIndex: number;
  canteenDayData: CanteenDayItem[];
  onClose: () => void;
  onNavigate: (index: number) => void;
  /**
   * Filled with this lightbox's animated close, so HomeClient's Escape and
   * Android-back handling close it the same way its own buttons do.
   */
  closeRef?: React.MutableRefObject<(() => void) | null>;
}

const OPEN_MS = 340;
const CLOSE_MS = 260;
const NAV_MS = 300;
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/** The transform that lays `el` exactly over `from` (FLIP), measured with no transform applied. */
function transformFrom(el: HTMLElement, from: DOMRect): string {
  const to = el.getBoundingClientRect();
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  return `translate(${dx}px, ${dy}px) scale(${from.width / to.width})`;
}

/**
 * The plate, enlarged — nothing else.
 *
 * One element makes the whole trip. The plate in this view animates from the
 * card's plate to the middle of the screen and back (FLIP, transform only, so
 * the compositor runs it). There used to be a separate flying copy that was
 * swapped for this image when it landed; the swap left a frame with neither on
 * screen, which was the flicker.
 *
 * Two layers inside it: the card's thumbnail, already decoded, so the very
 * first frame is the plate and never an empty square; and the full-size
 * picture over it, faded in once its bytes are in.
 *
 * The card's own plate is hidden for as long as this one is up (it used to
 * reappear behind the scrim the moment the flight landed), and comes back in
 * the same commit that removes this view, exactly where the plate lands.
 */
export default function Lightbox({ isOpen, currentIndex, canteenDayData, onClose, onNavigate, closeRef }: LightboxProps) {
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const plateRef = useRef<HTMLDivElement | null>(null);
  const scrimRef = useRef<HTMLDivElement | null>(null);
  const [hiResShown, setHiResShown] = useState<string | null>(null);
  const [failedIndex, setFailedIndex] = useState<number | null>(null);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  /** Which side the next plate slides in from after a swipe or arrow; 0 on open. */
  const enterDirRef = useRef(0);

  const current = canteenDayData[currentIndex];
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < canteenDayData.length - 1;

  const go = useCallback(
    (index: number) => {
      if (closingRef.current || index < 0 || index >= canteenDayData.length || index === currentIndex) return;
      enterDirRef.current = index > currentIndex ? 1 : -1;
      onNavigate(index);
    },
    [canteenDayData.length, currentIndex, onNavigate]
  );

  // The card's plate stays hidden while its double is up here.
  const canteen = current?.canteenName;
  useLayoutEffect(() => {
    if (!isOpen || !canteen) return;
    const origin = cardPlate(canteen);
    if (origin) origin.style.visibility = "hidden";
    return () => {
      if (origin) origin.style.visibility = "";
    };
  }, [isOpen, canteen]);

  // Arrival: the first plate grows out of its card; later ones slide in.
  useLayoutEffect(() => {
    const el = plateRef.current;
    if (!isOpen || !el || !current || prefersReducedMotion()) return;
    const dir = enterDirRef.current;
    if (dir === 0) {
      // A hidden plate keeps its box, so its rect is still the place to grow from.
      const origin = cardPlate(current.canteenName);
      if (origin) {
        el.animate([{ transform: transformFrom(el, origin.getBoundingClientRect()) }, { transform: "none" }], {
          duration: OPEN_MS,
          easing: EASE,
        });
      }
      scrimRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: OPEN_MS * 0.7, easing: "ease-out" });
    } else {
      el.animate(
        [{ transform: `translateX(${dir * 24}%) scale(0.94)`, opacity: 0 }, { transform: "none", opacity: 1 }],
        { duration: NAV_MS, easing: EASE }
      );
    }
    // Once per plate: `current` is a fresh object on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentIndex]);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    const el = plateRef.current;
    const scrim = scrimRef.current;
    const dest = current ? cardPlate(current.canteenName) : null;
    if (prefersReducedMotion() || !el || !scrim) {
      scrim?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: "forwards" });
      setTimeout(onClose, prefersReducedMotion() ? 150 : 0);
      return;
    }
    // The scrim leaves a little faster than the plate, so the plate lands on
    // the card and not on black.
    scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CLOSE_MS * 0.85, easing: "ease-in", fill: "forwards" });
    const flight = dest
      ? el.animate([{ transform: "none" }, { transform: transformFrom(el, dest.getBoundingClientRect()) }], {
          duration: CLOSE_MS,
          easing: EASE,
          fill: "forwards",
        })
      : el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: "forwards" });
    // Unmounting restores the card's plate in the same commit (the effect
    // above), so the frame after landing shows the card's own plate in place.
    flight.finished.then(onClose, onClose);
  }, [current, onClose]);

  useEffect(() => {
    if (!closeRef) return;
    closeRef.current = requestClose;
    return () => {
      closeRef.current = null;
    };
  }, [closeRef, requestClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(currentIndex - 1);
      else if (e.key === "ArrowRight") go(currentIndex + 1);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, currentIndex, go]);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(currentIndex + (dx < 0 ? 1 : -1));
  };

  if (!isOpen || !current) return null;
  const hiRes = failedIndex === currentIndex ? null : current.highResImagePath || null;
  const thumb = current.imagePath || null;

  // Portalled: HomeClient marks `.app-wrapper` inert while the lightbox is
  // open, and rendering inside it would make the lightbox inert too.
  return createPortal(
    // Just the plate, enlarged. A tap anywhere sends it home; a sideways swipe
    // or an arrow moves to the next kitchen's plate.
    <div
      className={`lightbox-overlay${closing ? " is-closing" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={current.mainDish?.dish || current.canteenName}
      onClick={requestClose}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Its own layer, so fading the dark never fades the plate with it. */}
      <div ref={scrimRef} className="lightbox-scrim" aria-hidden="true" />

      <button className="lightbox-close" onClick={requestClose} aria-label="Lukk">
        <X size={20} strokeWidth={2.25} />
      </button>

      {hasPrev && (
        <button
          className="lightbox-nav lightbox-prev"
          onClick={e => { e.stopPropagation(); go(currentIndex - 1); }}
          aria-label="Forrige"
        >
          <ChevronLeft size={22} strokeWidth={2.25} />
        </button>
      )}
      {hasNext && (
        <button
          className="lightbox-nav lightbox-next"
          onClick={e => { e.stopPropagation(); go(currentIndex + 1); }}
          aria-label="Neste"
        >
          <ChevronRight size={22} strokeWidth={2.25} />
        </button>
      )}

      <div ref={plateRef} key={currentIndex} className="lightbox-plate">
        {thumb || hiRes ? (
          <>
            {thumb && <img src={thumb} alt="" className="lightbox-image" decoding="sync" />}
            {hiRes && (
              <img
                src={hiRes}
                alt={current.mainDish?.dish || ""}
                className={`lightbox-image lightbox-image-hires${hiResShown === hiRes || !thumb ? " loaded" : ""}`}
                decoding="async"
                ref={el => { if (el?.complete && el.naturalWidth > 0 && hiResShown !== hiRes) setHiResShown(hiRes); }}
                onLoad={() => setHiResShown(hiRes)}
                onError={() => setFailedIndex(currentIndex)}
              />
            )}
          </>
        ) : (
          <div className="image-placeholder">{current.canteenName.charAt(0)}</div>
        )}
      </div>
    </div>,
    document.body
  );
}
