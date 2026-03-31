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
  const hasStengtDish = mainDish?.dish.toLowerCase().includes("stengt") ||
    items?.some((item) => item.dish.toLowerCase().includes("stengt"));
  const isClosed = hasStengtDish || (!mainDish && (!items || items.length === 0));

  if (isClosed) {
    return (
      <Wrapper3D maxRotation={4} translateZ={10} className="food-card-3d-wrapper">
        <article
          className="food-card no-menu"
          style={{ animationDelay: `${cardIdx * 75}ms` }}
        >
          {/* Hero zone — plate with resting cutlery */}
          <div className="no-menu-hero">
            <svg className="no-menu-plate-svg" viewBox="0 0 200 200" fill="none" aria-hidden="true">
              {/* Plate shadow */}
              <ellipse cx="102" cy="106" rx="78" ry="78" fill="rgba(100,60,10,0.07)" />
              {/* Plate rim */}
              <circle cx="100" cy="100" r="82" fill="#d8c49e" />
              <circle cx="100" cy="100" r="81" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.2" />
              <circle cx="100" cy="100" r="76" fill="none" stroke="#c4ad85" strokeWidth="0.6" opacity="0.4" />
              {/* Inner plate */}
              <circle cx="100" cy="100" r="64" fill="url(#plateFill)" />
              <circle cx="100" cy="100" r="64" fill="none" stroke="#c4ad85" strokeWidth="0.5" opacity="0.3" />
              {/* Plate highlight */}
              <ellipse cx="82" cy="82" rx="28" ry="22" fill="white" opacity="0.06" />

              {/* Fork — left, angled */}
              <g transform="rotate(-28 72 100)" opacity="0.42">
                <line x1="66" y1="42" x2="66" y2="68" stroke="#a08050" strokeWidth="2" strokeLinecap="round" />
                <line x1="70" y1="40" x2="70" y2="70" stroke="#a08050" strokeWidth="2" strokeLinecap="round" />
                <line x1="74" y1="40" x2="74" y2="70" stroke="#a08050" strokeWidth="2" strokeLinecap="round" />
                <line x1="78" y1="42" x2="78" y2="68" stroke="#a08050" strokeWidth="2" strokeLinecap="round" />
                <path d="M66 68 Q72 76 78 68" stroke="#a08050" strokeWidth="2" fill="none" />
                <line x1="72" y1="74" x2="72" y2="150" stroke="#a08050" strokeWidth="3" strokeLinecap="round" />
                <ellipse cx="72" cy="150" rx="5" ry="3" fill="#a08050" opacity="0.5" />
              </g>

              {/* Knife — right, angled */}
              <g transform="rotate(28 128 100)" opacity="0.42">
                <line x1="128" y1="38" x2="128" y2="150" stroke="#a08050" strokeWidth="3" strokeLinecap="round" />
                <path d="M128 38 C138 46 137 78 128 86" stroke="#a08050" strokeWidth="1.8" fill="#a08050" fillOpacity="0.1" strokeLinecap="round" />
                <ellipse cx="128" cy="150" rx="5" ry="3" fill="#a08050" opacity="0.5" />
              </g>

              <defs>
                <radialGradient id="plateFill" cx="45%" cy="42%">
                  <stop offset="0%" stopColor="#e6d8ba" />
                  <stop offset="100%" stopColor="#dac8a4" />
                </radialGradient>
              </defs>
            </svg>
          </div>

          {/* Text block + hours */}
          <div className="no-menu-body">
            <span className="no-menu-canteen-label">{canteenName}</span>
            <h3 className="no-menu-heading">
              {lang === "no" ? "Ingen servering" : "Not serving"}
            </h3>
            <p className="no-menu-sub">
              {lang === "no" ? "Kantinen holder stengt i dag" : "The canteen is closed today"}
            </p>
            <div className="no-menu-hours">
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
