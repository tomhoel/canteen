"use client";

import { useState, memo } from "react";
import type { CanteenDayItem } from "@/lib/types";
import { Wrapper3D } from "@/components/ui/3d-wrapper";
import { markImageCached } from "@/lib/imageCache";
import { getCanteenMetadata } from "@/lib/constants";
import { MapPin } from "lucide-react";

interface ClosedCardProps {
  data: CanteenDayItem;
  cardIdx: number;
  lang: "no" | "en";
  onOpenMap?: (canteenId: string) => void;
}

const ClosedCard = memo(function ClosedCard({ data, cardIdx, lang, onOpenMap }: ClosedCardProps) {
  const [imgError, setImgError] = useState(false);
  const meta = getCanteenMetadata(data.canteenName);

  return (
    <Wrapper3D maxRotation={4} translateZ={10} className="food-card-3d-wrapper">
      <article
        className="food-card closed"
        data-yolo-card-key={data.canteenName}
      >
        <div className="card-image-wrapper closed">
          <div className="card-image-circle">
            {imgError || !data.imagePath ? (
              <div className="image-placeholder">?</div>
            ) : (
              <div className="plate-float-container">
                <img
                  src={data.imagePath}
                  alt={lang === "no" ? "Stengt" : "Closed"}
                  className="food-image loaded"
                  loading="eager"
                  decoding="async"
                  fetchPriority={cardIdx === 0 ? "high" : undefined}
                  onLoad={() => markImageCached(data.imagePath)}
                  onError={() => setImgError(true)}
                />
              </div>
            )}
          </div>
        </div>

        <div className="closed-card-body">
          <div className="canteen-header-row">
            <span className="closed-card-eyebrow">{meta.name}</span>
            <button
              type="button"
              className="canteen-location-chip"
              onClick={(e) => {
                e.stopPropagation();
                onOpenMap?.(meta.id);
              }}
              title={lang === "no" ? `Se ${meta.building} på kart` : `View ${meta.building} on map`}
              aria-label={lang === "no" ? `Se ${meta.building} på kart` : `View ${meta.building} on map`}
            >
              <MapPin size={10} strokeWidth={2.4} />
              <span>{meta.buildingShort}</span>
            </button>
          </div>
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
              <strong>{meta.hours || data.canteen.openingHours}</strong>
            </span>
          </div>
        </div>
      </article>
    </Wrapper3D>
  );
});

export default ClosedCard;
