import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import type { CanteenDayItem } from "@/lib/types";

interface LightboxProps {
  isOpen: boolean;
  currentIndex: number;
  canteenDayData: CanteenDayItem[];
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export default function Lightbox({ isOpen, currentIndex, canteenDayData, onClose, onNavigate }: LightboxProps) {
  const touchStartRef = useRef<number | null>(null);
  const touchEndRef = useRef<number | null>(null);
  const [failedIndex, setFailedIndex] = useState<number | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  useEffect(() => {
    setImgLoaded(false);
  }, [currentIndex]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && currentIndex > 0) onNavigate(currentIndex - 1);
      else if (e.key === "ArrowRight" && currentIndex < canteenDayData.length - 1) onNavigate(currentIndex + 1);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, currentIndex, canteenDayData.length, onClose, onNavigate]);

  const current = canteenDayData[currentIndex];
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < canteenDayData.length - 1;

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

  return (
    <AnimatePresence>
      {isOpen && current && (
        <motion.div
          key="lightbox-overlay"
          className="lightbox-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        >
          <motion.div
            key="lightbox-content"
            className="lightbox-content"
            initial={{ scale: 0.92, y: 16, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.92, y: 16, opacity: 0 }}
            transition={{ type: "spring", stiffness: 340, damping: 28 }}
            onClick={e => e.stopPropagation()}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            <button className="lightbox-close" onClick={onClose} aria-label="Lukk">
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
                  className={`lightbox-image${imgLoaded ? " loaded" : ""}`}
                  decoding="async"
                  ref={el => { if (el?.complete && el.naturalWidth > 0) setImgLoaded(true); }}
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
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
