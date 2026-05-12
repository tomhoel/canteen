"use client";

import { useState } from "react";
import type { CanteenDayItem } from "@/lib/types";
import { Wrapper3D } from "@/components/ui/3d-wrapper";

interface ClosedCardProps {
  data: CanteenDayItem;
  cardIdx: number;
  lang: "no" | "en";
}

export default function ClosedCard({ data, cardIdx, lang }: ClosedCardProps) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  return (
    <Wrapper3D maxRotation={4} translateZ={10} className="food-card-3d-wrapper">
      <article
        className="food-card closed"
        style={{ animationDelay: `${cardIdx * 75}ms` }}
        data-yolo-card-key={data.canteenName}
      >
        <div className="card-image-wrapper closed">
          <div className="card-image-circle">
            {imgError ? (
              <div className="image-placeholder">?</div>
            ) : (
              <>
                {!imgLoaded && <div className="image-shimmer" />}
                <img
                  src={data.imagePath}
                  alt={lang === "no" ? "Stengt" : "Closed"}
                  className={`food-image${imgLoaded ? " loaded" : ""}`}
                  loading="lazy"
                  onLoad={() => setImgLoaded(true)}
                  onError={() => setImgError(true)}
                />
              </>
            )}
          </div>
        </div>

        <div className="closed-card-body">
          <h3 className="canteen-name">{data.canteenName}</h3>
          <p className="closed-card-status">
            {lang === "no" ? "Stengt i dag" : "Closed today"}
          </p>
          <p className="closed-card-hours">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            {lang === "no" ? "Vanligvis åpen" : "Usually open"}{" "}
            <strong>{data.canteen.openingHours}</strong>
          </p>
        </div>
      </article>
    </Wrapper3D>
  );
}
