import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import type { CanteenDayItem } from "@/lib/types";
import { cardPlate, flyPlate, prefersReducedMotion } from "@/lib/plate-flight";

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

/** Card to viewer, and back. The viewer's panel fades in under the plate. */
const OPEN_MS = 320;
const CLOSE_MS = 240;

export default function Lightbox({ isOpen, currentIndex, canteenDayData, onClose, onNavigate, closeRef }: LightboxProps) {
  const touchStartRef = useRef<number | null>(null);
  const touchEndRef = useRef<number | null>(null);
  const [failedIndex, setFailedIndex] = useState<number | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  /** The flying copy of the plate, while there is one. */
  const ghostRef = useRef<HTMLImageElement | null>(null);
  /** True from opening until the plate has landed and the full picture can replace it. */
  const [flying, setFlying] = useState(false);
  const [landed, setLanded] = useState(false);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

  const current = canteenDayData[currentIndex];
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < canteenDayData.length - 1;

  useEffect(() => {
    setImgLoaded(false);
  }, [currentIndex]);

  // Opening: the plate leaves its card and grows into place.
  useLayoutEffect(() => {
    if (!isOpen || !current || prefersReducedMotion()) return;
    const origin = cardPlate(current.canteenName);
    const target = imgRef.current;
    if (!origin || !target || !current.imagePath) return;
    const from = origin.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    origin.style.visibility = "hidden";
    setFlying(true);
    ghostRef.current = flyPlate(current.imagePath, from, to, OPEN_MS, () => {
      origin.style.visibility = "";
      setLanded(true);
    });
    return () => {
      origin.style.visibility = "";
      ghostRef.current?.remove();
      ghostRef.current = null;
    };
    // Once, on open: navigating inside the viewer does not fly anything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The card's picture stays in place until the full-size one has loaded under it.
  useEffect(() => {
    // Only the opening flight hands over here; the closing one owns its own end.
    if (closing || !flying || !landed || (!imgLoaded && failedIndex !== currentIndex)) return;
    ghostRef.current?.remove();
    ghostRef.current = null;
    setFlying(false);
  }, [closing, flying, landed, imgLoaded, failedIndex, currentIndex]);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    const img = imgRef.current;
    const dest = current ? cardPlate(current.canteenName) : null;
    if (prefersReducedMotion() || !img || !dest || !current) {
      setClosing(true);
      // Reduced motion still gets the fade (see .lightbox-overlay.is-closing).
      setTimeout(onClose, prefersReducedMotion() ? 150 : 0);
      return;
    }
    const src = ghostRef.current?.src || (imgLoaded ? img.currentSrc : current.imagePath) || "";
    ghostRef.current?.remove();
    ghostRef.current = null;
    const from = img.getBoundingClientRect();
    const to = dest.getBoundingClientRect();
    dest.style.visibility = "hidden";
    setFlying(true);
    setClosing(true);
    // Fly from the viewer to the card: laid out at the card, starting at the viewer.
    flyPlate(src, from, to, CLOSE_MS, (ghost) => {
      dest.style.visibility = "";
      ghost.remove();
      onClose();
    });
  }, [current, imgLoaded, onClose]);

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
      if (e.key === "ArrowLeft" && currentIndex > 0) onNavigate(currentIndex - 1);
      else if (e.key === "ArrowRight" && currentIndex < canteenDayData.length - 1) onNavigate(currentIndex + 1);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, currentIndex, canteenDayData.length, onNavigate]);

  const onTouchStart = (e: React.TouchEvent) => {
    touchEndRef.current = null;
    touchStartRef.current = e.targetTouches[0].clientX;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    touchEndRef.current = e.targetTouches[0].clientX;
  };

  const onTouchEnd = () => {
    const start = touchStartRef.current;
    const end = touchEndRef.current;
    if (start === null || end === null) return;
    const distance = start - end;
    const minSwipe = 50;
    if (distance > minSwipe && hasNext) onNavigate(currentIndex + 1);
    else if (distance < -minSwipe && hasPrev) onNavigate(currentIndex - 1);
  };

  // Portalled, for the same reason ui/sheet.tsx is: HomeClient marks
  // `.app-wrapper` inert while the lightbox is open and the lightbox would
  // otherwise render inside it.
  return createPortal(
    <>
      {isOpen && current && (
        <div
          className={`lightbox-overlay${closing ? " is-closing" : ""}`}
          onClick={requestClose}
        >
          <div
            className={`lightbox-content${closing ? " is-closing" : ""}`}
            onClick={e => e.stopPropagation()}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            <button className="lightbox-close" onClick={requestClose} aria-label="Lukk">
              <X size={18} strokeWidth={2.5} />
            </button>

            {hasPrev && (
              <button
                className="lightbox-nav lightbox-prev"
                onClick={() => onNavigate(currentIndex - 1)}
                aria-label="Forrige"
              >
                <ChevronLeft size={24} strokeWidth={2.5} />
              </button>
            )}
            {hasNext && (
              <button
                className="lightbox-nav lightbox-next"
                onClick={() => onNavigate(currentIndex + 1)}
                aria-label="Neste"
              >
                <ChevronRight size={24} strokeWidth={2.5} />
              </button>
            )}

            <div className="lightbox-image-container">
              {failedIndex === currentIndex || !current.highResImagePath ? (
                <div className="image-placeholder">{current.canteenName.charAt(0)}</div>
              ) : (
                <img
                  key={current.highResImagePath}
                  src={current.highResImagePath}
                  alt={current.mainDish?.dish || ""}
                  className={`lightbox-image${imgLoaded ? " loaded" : ""}${flying ? " is-flying" : ""}${landed ? " landed" : ""}`}
                  decoding="async"
                  ref={el => {
                    imgRef.current = el;
                    if (el?.complete && el.naturalWidth > 0) setImgLoaded(true);
                  }}
                  onLoad={() => setImgLoaded(true)}
                  onError={() => setFailedIndex(currentIndex)}
                />
              )}
            </div>
            <div className="lightbox-info">
              <p className="lightbox-canteen">{current.canteenName}</p>
              <h2 className="lightbox-dish-name">{current.mainDish?.dish || ""}</h2>
              <div className="lightbox-dots">
                {canteenDayData.map((_, i) => (
                  <span
                    key={i}
                    className={`lightbox-dot${i === currentIndex ? " active" : ""}`}
                    onClick={() => onNavigate(i)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  );
}
