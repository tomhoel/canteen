"use client";

import { useState } from "react";
import type { CanteenDayItem } from "@/lib/types";
import { Wrapper3D } from "@/components/ui/3d-wrapper";

interface AllClosedCardProps {
  closedCanteens: CanteenDayItem[];
  lang: "no" | "en";
}

export default function AllClosedCard({ closedCanteens, lang }: AllClosedCardProps) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  // Use the first canteen's image path for the plate photo
  const imagePath = closedCanteens[0]?.imagePath;

  return (
    <Wrapper3D maxRotation={4} translateZ={10} className="food-card-3d-wrapper">
      <article className="all-closed-card">
        {/* Plate image */}
        <div className="all-closed-image">
          <div className="card-image-circle">
            {imgError ? (
              <div className="image-placeholder">?</div>
            ) : (
              <>
                <div className={`image-shimmer${imgLoaded ? " loaded" : ""}`} aria-hidden="true" />
                <img
                  src={imagePath}
                  alt={lang === "no" ? "Stengt" : "Closed"}
                  className={`food-image${imgLoaded ? " loaded" : ""}`}
                  loading="eager"
                  decoding="async"
                  onLoad={() => setImgLoaded(true)}
                  onError={() => setImgError(true)}
                />
              </>
            )}
          </div>
        </div>

        {/* Heading */}
        <h3 className="all-closed-heading">
          {lang === "no" ? "Ingen servering i dag" : "Not serving today"}
        </h3>
        <p className="all-closed-sub">
          {lang === "no" ? "Alle kantiner holder stengt" : "All canteens are closed"}
        </p>

        {/* Canteen hours list */}
        <div className="all-closed-hours">
          {closedCanteens.map(c => (
            <div key={c.canteenName} className="all-closed-row">
              <span className="all-closed-name">{c.canteenName}</span>
              <span className="all-closed-time">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                </svg>
                {lang === "no" ? "Vanligvis åpen" : "Usually open"} <strong>{c.canteen.openingHours}</strong>
              </span>
            </div>
          ))}
        </div>
      </article>
    </Wrapper3D>
  );
}
