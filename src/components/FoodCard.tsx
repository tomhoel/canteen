import { useState } from "react";
import { ALLERGEN_COLORS, ALLERGEN_NAMES_NO } from "@/lib/constants";
import type { CanteenDayItem } from "@/lib/types";
import { Wrapper3D } from "@/components/ui/3d-wrapper";

const COUNTRY_ADJECTIVES: Record<string, { no: string; en: string }> = {
  turkey: { no: "Tyrkisk", en: "Turkish" },
  italy: { no: "Italiensk", en: "Italian" },
  mexico: { no: "Meksikansk", en: "Mexican" },
  japan: { no: "Japansk", en: "Japanese" },
  china: { no: "Kinesisk", en: "Chinese" },
  india: { no: "Indisk", en: "Indian" },
  thailand: { no: "Thailandsk", en: "Thai" },
  usa: { no: "Amerikansk", en: "American" },
  "united states": { no: "Amerikansk", en: "American" },
  france: { no: "Fransk", en: "French" },
  spain: { no: "Spansk", en: "Spanish" },
  greece: { no: "Gresk", en: "Greek" },
  vietnam: { no: "Vietnamesisk", en: "Vietnamese" },
  korea: { no: "Koreansk", en: "Korean" },
  morocco: { no: "Marokkansk", en: "Moroccan" },
  brazil: { no: "Brasiliansk", en: "Brazilian" },
  peru: { no: "Peruansk", en: "Peruvian" },
  sweden: { no: "Svensk", en: "Swedish" },
  norway: { no: "Norsk", en: "Norwegian" },
  denmark: { no: "Dansk", en: "Danish" },
  "united kingdom": { no: "Britisk", en: "British" },
  uk: { no: "Britisk", en: "British" },
  lebanon: { no: "Libanesisk", en: "Lebanese" },
  indonesia: { no: "Indonesisk", en: "Indonesian" },
  philippines: { no: "Filippinsk", en: "Filipino" },
  portugal: { no: "Portugisisk", en: "Portuguese" },
  poland: { no: "Polsk", en: "Polish" },
  germany: { no: "Tysk", en: "German" },
  netherlands: { no: "Nederlandsk", en: "Dutch" },
  argentina: { no: "Argentinsk", en: "Argentine" },
  colombia: { no: "Kolombiansk", en: "Colombian" },
  malaysia: { no: "Malaysisk", en: "Malaysian" },
  pakistan: { no: "Pakistansk", en: "Pakistani" },
  hungary: { no: "Ungarsk", en: "Hungarian" },
  austria: { no: "Østerriksk", en: "Austrian" },
  barbados: { no: "Barbadisk", en: "Barbadian" },
};

function getCountryAdjective(country: string, lang: "no" | "en"): string {
  const key = country.toLowerCase().trim();
  return COUNTRY_ADJECTIVES[key]?.[lang] || country;
}

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
  const [imgLoaded, setImgLoaded] = useState(false);

  const {
    canteenName,
    mainDish,
    items,
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
  const hasStengtDish = mainDish?.toLowerCase().includes("stengt") ||
    items?.some((item) => item.toLowerCase().includes("stengt"));
  const isClosed = hasStengtDish || (!mainDish && (!items || items.length === 0));

  if (isClosed) {
    return (
      <Wrapper3D maxRotation={4} translateZ={10} className="food-card-3d-wrapper">
        <article
          className="food-card no-menu"
          style={{ animationDelay: `${cardIdx * 75}ms` }}
        >
          {/* Hero zone — warm gradient with centered illustration */}
          <div className="no-menu-hero">
            {/* Decorative concentric rings */}
            <svg className="no-menu-rings" viewBox="0 0 328 220" fill="none" aria-hidden="true">
              <ellipse cx="164" cy="150" rx="150" ry="95" stroke="#c8741a" strokeWidth="1" strokeDasharray="3 9" opacity="0.18" />
              <ellipse cx="164" cy="150" rx="115" ry="72" stroke="#c8741a" strokeWidth="1" strokeDasharray="3 9" opacity="0.22" />
              <ellipse cx="164" cy="150" rx="80" ry="50" stroke="#c8741a" strokeWidth="1" strokeDasharray="3 9" opacity="0.28" />
            </svg>

            {/* Cloche SVG */}
            <div className="no-menu-cloche-wrap">
              <svg className="no-menu-cloche-svg" viewBox="0 0 190 158" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* Ground shadow */}
                <ellipse cx="95" cy="150" rx="68" ry="7.5" fill="#c8741a" opacity="0.14" />
                {/* Plate */}
                <ellipse cx="95" cy="141" rx="72" ry="11" fill="#f5e0b5" stroke="#d4a870" strokeWidth="1.5" />
                {/* Plate inner groove */}
                <ellipse cx="95" cy="141" rx="54" ry="7.5" fill="none" stroke="#d4a870" strokeWidth="0.8" opacity="0.5" />
                {/* Dome */}
                <path d="M23 141 C23 141 20 76 95 52 C170 76 167 141 167 141 Z" fill="url(#domeGrad)" />
                {/* Dome outline */}
                <path d="M23 141 C23 141 20 76 95 52 C170 76 167 141 167 141" stroke="#c8741a" strokeWidth="2" strokeLinejoin="round" fill="none" />
                {/* Primary sheen */}
                <path d="M44 108 C49 86 63 70 82 62" stroke="white" strokeWidth="3.5" strokeLinecap="round" opacity="0.48" />
                {/* Secondary sheen */}
                <path d="M54 128 C56 118 60 112 66 108" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.28" />
                {/* Handle stem */}
                <rect x="90.5" y="38" width="9" height="17" rx="4.5" fill="#c8741a" />
                {/* Handle base ring */}
                <circle cx="95" cy="35" r="12" fill="#c8741a" />
                {/* Handle gem */}
                <circle cx="95" cy="35" r="6.5" fill="#e8a020" />
                {/* Handle gem highlight */}
                <circle cx="92" cy="32" r="2" fill="white" opacity="0.4" />
                <defs>
                  <linearGradient id="domeGrad" x1="95" y1="52" x2="95" y2="141" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#fef6e4" />
                    <stop offset="100%" stopColor="#f6e4bc" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
          </div>

          {/* Centered text block */}
          <div className="no-menu-body">
            <span className="no-menu-canteen-label">{canteenName}</span>
            <h3 className="no-menu-heading">
              {lang === "no" ? "Ingen servering" : "Not serving"}
            </h3>
            <p className="no-menu-sub">
              {lang === "no" ? "Kantinen holder stengt i dag" : "The canteen is closed today"}
            </p>
          </div>

          {/* Hours pill */}
          <div className="no-menu-footer">
            <div className="no-menu-pill">
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

  return (
    <Wrapper3D maxRotation={6} translateZ={18} className="food-card-3d-wrapper">
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
            <>
              {!imgLoaded && <div className="image-shimmer" />}
              <img
                src={imagePath}
                alt={mainDish?.dish || "Matrett"}
                className={`food-image${imgLoaded ? " loaded" : ""}`}
                loading="lazy"
                onLoad={() => setImgLoaded(true)}
                onError={() => setImgError(true)}
              />
            </>
          )}
        </div>
        {isOutdated && (
          <div className="stale-image-badge">
            {lang === "no" ? `Uke ${canteenWeekNum}` : `Wk ${canteenWeekNum}`}
          </div>
        )}
        <span className="click-hint">{lang === "no" ? "Klikk for st\u00F8rre" : "Click to enlarge"}</span>
        {origin && mainDish && (
          <div className="origin-pip">
            <span className="emoji-flag">{origin.code.toUpperCase().split("").map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join("")}</span>
            <img className="image-flag" src={`https://flagcdn.com/w20/${origin.code.toLowerCase()}.png`} alt={origin.country} />
            <span className="origin-pip-name">{getCountryAdjective(origin.country, lang)}</span>
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
    </Wrapper3D>
  );
}
