"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { CanteenDayItem } from "@/lib/types";
import { Wrapper3D } from "@/components/ui/3d-wrapper";
import { markImageCached } from "@/lib/imageCache";

interface ClosedCardProps {
  data: CanteenDayItem;
  cardIdx: number;
  lang: "no" | "en";
}

export default function ClosedCard({ data, cardIdx, lang }: ClosedCardProps) {
  const [imgError, setImgError] = useState(false);

  return (
    <Wrapper3D maxRotation={4} translateZ={10} className="food-card-3d-wrapper">
      <article
        className="food-card closed"
        style={{
          animationDelay: `${cardIdx * 55}ms`,
          animationDuration: `${0.28 + cardIdx * 0.04}s`,
        }}
        data-yolo-card-key={data.canteenName}
      >
        <div className="card-image-wrapper closed">
          <div className="card-image-circle">
            {imgError || !data.imagePath ? (
              <div className="image-placeholder">?</div>
            ) : (
              <div className="plate-float-container">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.img
                    key={data.imagePath}
                    src={data.imagePath}
                    alt={lang === "no" ? "Stengt" : "Closed"}
                    className="food-image loaded"
                    initial={{ opacity: 0, scale: 1.1, x: 28 }}
                    animate={{ opacity: 1, scale: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.88, x: -24 }}
                    transition={{
                      type: "spring",
                      stiffness: 240,
                      damping: 24,
                      mass: 0.7,
                      opacity: { duration: 0.28 },
                    }}
                    loading="eager"
                    decoding="async"
                    fetchPriority={cardIdx === 0 ? "high" : undefined}
                    onLoad={() => markImageCached(data.imagePath)}
                    onError={() => setImgError(true)}
                  />
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>

        <div className="closed-card-body">
          <span className="closed-card-eyebrow">{data.canteenName}</span>
          <h3 className="closed-card-heading">
            {lang === "no" ? "Ingen servering" : "Not serving"}
          </h3>
          <p className="closed-card-sub">
            {lang === "no" ? "Kantinen holder stengt i dag" : "The canteen is closed today"}
          </p>
          <div className="closed-card-hours">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            <span>
              {lang === "no" ? "Vanligvis åpen" : "Usually open"}{" "}
              <strong>{data.canteen.openingHours}</strong>
            </span>
          </div>
        </div>
      </article>
    </Wrapper3D>
  );
}
