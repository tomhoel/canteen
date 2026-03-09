import { useState } from "react";
import { ALLERGEN_COLORS, ALLERGEN_NAMES_NO } from "@/lib/constants";
import type { CanteenDayItem } from "@/lib/types";

interface FoodCardProps {
  data: CanteenDayItem;
  cardIdx: number;
  lang: "no" | "en";
  selectedDay: number;
  activeDayIndex: number;
  voteCount: number;
  maxVotes: number;
  onImageClick: (data: CanteenDayItem) => void;
  onCardClick: (canteenName: string) => void;
}

export default function FoodCard({
  data,
  cardIdx,
  lang,
  selectedDay,
  activeDayIndex,
  voteCount,
  maxVotes,
  onImageClick,
  onCardClick,
}: FoodCardProps) {
  const [imgError, setImgError] = useState(false);

  const {
    canteenName,
    mainDish,
    sideDishes,
    mainAllergens,
    imagePath,
    isOutdated,
    isAhead,
    canteenWeekNum,
    origin,
    description,
  } = data;

  const isVoteable = selectedDay === activeDayIndex && !isOutdated && !isAhead;
  const isLeader = voteCount > 0 && voteCount === maxVotes;

  return (
    <article
      className={`food-card${mainDish ? " clickable" : ""}${isVoteable ? " voteable" : ""}${isOutdated ? " outdated" : ""}${isAhead ? " ahead" : ""}`}
      style={{ animationDelay: `${cardIdx * 75}ms` }}
      onClick={mainDish ? () => onCardClick(canteenName) : undefined}
    >
      {isVoteable && voteCount > 0 && (
        <div className={`vote-pip${isLeader ? " leader" : ""}`}>
          <svg className="vote-pip-icon" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="8" cy="5" r="3" />
            <path d="M2 15c0-3.3 2.7-6 6-6s6 2.7 6 6" />
          </svg>
          <span>{voteCount}</span>
        </div>
      )}
      <div
        className="card-image-wrapper"
        onClick={e => { e.stopPropagation(); mainDish && onImageClick(data); }}
      >
        <div className="card-image-circle">
          {imgError ? (
            <div className="image-placeholder">
              {canteenName.charAt(0)}
            </div>
          ) : (
            <img
              src={imagePath}
              alt={mainDish?.dish || "Matrett"}
              className="food-image"
              loading="lazy"
              onError={() => setImgError(true)}
            />
          )}
        </div>
        {isOutdated && (
          <div className="stale-image-badge">
            {lang === "no" ? `Uke ${canteenWeekNum}` : `Wk ${canteenWeekNum}`}
          </div>
        )}
        <span className="click-hint">{lang === "no" ? "Klikk for st\u00F8rre" : "Click to enlarge"}</span>
        {origin && (
          <div className="origin-stamp" data-country={origin.country}>
            <img
              className="origin-flag"
              src={`https://flagcdn.com/w40/${origin.code}.png`}
              srcSet={`https://flagcdn.com/w80/${origin.code}.png 2x`}
              alt={origin.country}
            />
          </div>
        )}
      </div>
      <div className="card-content">
        <div className="card-header">
          <div className="canteen-name">
            {canteenName}
            {isAhead && (
              <span className="ahead-tag">
                {lang === "no" ? `Uke ${canteenWeekNum}` : `Wk ${canteenWeekNum}`} &#x2728;
              </span>
            )}
          </div>
          <h3 className="dish-name">{mainDish?.dish || (lang === "no" ? "Ingen meny" : "No menu")}</h3>
        </div>

        {mainAllergens.length > 0 && (
          <div className="dish-meta-row">
            <div className="allergens-row">
              {mainAllergens.map((a, aIdx) => {
                const displayName = lang === "no" ? (ALLERGEN_NAMES_NO[a.name] || a.name) : a.name;
                return (
                <span
                  key={a.id}
                  className="allergen-chip"
                  style={{
                    color: ALLERGEN_COLORS[a.name] || "#8E8E93",
                    background: `${ALLERGEN_COLORS[a.name] || "#8E8E93"}1a`,
                    borderColor: `${ALLERGEN_COLORS[a.name] || "#8E8E93"}44`,
                    animationDelay: `${aIdx * 50}ms`,
                  }}
                >
                  {displayName}
                </span>
                );
              })}
            </div>
          </div>
        )}

        {description && (
          <p className="dish-description">{description}</p>
        )}
      </div>

      {isOutdated && (
        <div className="stale-banner">
          <span className="stale-banner-icon">&#x23F0;</span>
          <div className="stale-banner-text">
            <strong>{lang === "no" ? "Ikke oppdatert" : "Not updated"}</strong>
            <span>{lang === "no" ? `Viser meny for uke ${canteenWeekNum}` : `Showing menu from week ${canteenWeekNum}`}</span>
          </div>
        </div>
      )}
      <div className="card-bottom">
        <div className="side-dishes-title">{lang === "no" ? "Andre retter" : "Other dishes"}</div>
        <div className="side-dish-list">
          {sideDishes.length > 0 ? sideDishes.map((item, idx) => (
            <div key={idx} className="side-dish-item">
              <span className="side-dish-text">{item.dish}</span>
              {item.allergens.length > 0 && (
                <span className="side-allergens">{item.allergens.map(a => (lang === "no" ? (ALLERGEN_NAMES_NO[a.name] || a.name) : a.name).charAt(0)).join("")}</span>
              )}
            </div>
          )) : (
            <div className="side-dish-item" style={{ justifyContent: "center", color: "var(--text-muted)" }}>
              {lang === "no" ? "Ingen andre retter" : "No other dishes"}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
