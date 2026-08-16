import { useEffect, useRef, useState } from "react";
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
  // Every card has an onError placeholder; this was the one <img> without one,
  // so a plate that has never been drawn showed the browser's broken-image
  // glyph full-screen. Keyed by index so swiping to the next dish clears it.
  const [failedIndex, setFailedIndex] = useState<number | null>(null);

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

  if (!isOpen || currentIndex < 0 || currentIndex >= canteenDayData.length) return null;

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
    <div className="lightbox-overlay" onClick={onClose}>
      <div
        className="lightbox-content"
        onClick={e => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <button className="lightbox-close" onClick={onClose}>&times;</button>

        {hasPrev && (
          <button className="lightbox-nav lightbox-prev" onClick={() => onNavigate(currentIndex - 1)}>
            &#x2039;
          </button>
        )}
        {hasNext && (
          <button className="lightbox-nav lightbox-next" onClick={() => onNavigate(currentIndex + 1)}>
            &#x203A;
          </button>
        )}

        <div className="lightbox-image-container">
          {failedIndex === currentIndex || !current.highResImagePath ? (
            <div className="image-placeholder">{current.canteenName.charAt(0)}</div>
          ) : (
            <img
              src={current.highResImagePath}
              alt={current.mainDish?.dish || ""}
              className="lightbox-image"
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
  );
}
