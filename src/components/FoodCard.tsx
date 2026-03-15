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
  const isClosed = !mainDish && (!items || items.length === 0);

  if (isClosed) {
    return (
      <Wrapper3D maxRotation={4} translateZ={10} className="food-card-3d-wrapper">
        <article
          className="food-card no-menu"
          style={{ animationDelay: `${cardIdx * 75}ms` }}
        >
          {/* Illustration circle — same position/size as food image */}
          <div className="card-image-wrapper" style={{ cursor: "default" }}>
            <div className="card-image-circle">
              <div className="no-menu-illustration">
                {/* Warm gradient blob behind cloche */}
                <svg className="no-menu-svg" viewBox="0 0 160 160" fill="none" xmlns="http://www.w3.org/2000/svg">
                  {/* Glow blob */}
                  <ellipse cx="80" cy="82" rx="62" ry="58" fill="url(#blobGrad)" opacity="0.55" />
                  {/* Plate shadow */}
                  <ellipse cx="80" cy="126" rx="50" ry="7" fill="#c8741a" opacity="0.12" />
                  {/* Plate rim */}
                  <ellipse cx="80" cy="122" rx="52" ry="8.5" fill="#eddbbf" stroke="#d4a96a" strokeWidth="1.2" />
                  {/* Cloche dome */}
                  <path d="M28 122 C28 122 26 76 80 58 C134 76 132 122 132 122 Z" fill="#fdf0d8" stroke="#c8741a" strokeWidth="1.8" strokeLinejoin="round" />
                  {/* Dome sheen */}
                  <path d="M48 95 C50 80 60 68 75 63" stroke="white" strokeWidth="2.5" strokeLinecap="round" opacity="0.55" />
                  {/* Handle stem */}
                  <rect x="76.5" y="46" width="7" height="14" rx="3.5" fill="#c8741a" opacity="0.8" />
                  {/* Handle knob */}
                  <circle cx="80" cy="43" r="8" fill="#c8741a" opacity="0.85" />
                  <circle cx="80" cy="43" r="4.5" fill="#e8a020" opacity="0.7" />
                  {/* Fork left */}
                  <g opacity="0.35" transform="translate(22,78) rotate(-22)">
                    <rect x="4" y="0" width="2" height="22" rx="1" fill="#c8741a"/>
                    <rect x="1" y="0" width="1.5" height="10" rx="0.75" fill="#c8741a"/>
                    <rect x="6.5" y="0" width="1.5" height="10" rx="0.75" fill="#c8741a"/>
                  </g>
                  {/* Knife right */}
                  <g opacity="0.35" transform="translate(132,78) rotate(22) scale(-1,1) translate(-10,0)">
                    <rect x="4" y="0" width="2" height="22" rx="1" fill="#c8741a"/>
                    <path d="M6 0 Q10 5 6 10 Z" fill="#c8741a"/>
                  </g>
                  <defs>
                    <radialGradient id="blobGrad" cx="40%" cy="35%" r="60%">
                      <stop offset="0%" stopColor="#fde8b8" />
                      <stop offset="100%" stopColor="#f0c87a" />
                    </radialGradient>
                  </defs>
                </svg>
              </div>
            </div>
          </div>

          {/* Card content — same structure as normal card */}
          <div className="card-content">
            <div className="card-header">
              <div className="canteen-name">{canteenName}</div>
              <h3 className="dish-name no-menu-title">
                {lang === "no" ? "Ingen servering" : "Not serving today"}
              </h3>
            </div>
            <p className="no-menu-subtitle">
              {lang === "no"
                ? "Kantinen holder stengt i dag"
                : "The canteen is closed today"}
            </p>
          </div>

          {/* Bottom — opening hours instead of side dishes */}
          <div className="card-bottom no-menu-bottom">
            <div className="no-menu-hours-row">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.5 }}>
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span className="no-menu-hours-text">
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
