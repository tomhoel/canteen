import { useState } from "react";
import { ALLERGEN_COLORS, ALLERGEN_NAMES_NO, ALLERGEN_ABBREV, ALLERGEN_ABBREV_NO } from "@/lib/constants";
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
  /** -1 on weekends; voteable styling hides automatically. */
  todayIndex: number;
  voteCount: number;
  maxVotes: number;
  onImageClick: (data: CanteenDayItem) => void;
  onCardClick: (canteenName: string) => void;
  /** True while the YOLO spinner has the cycling highlight on this card. */
  yoloHighlighted?: boolean;
  /** True after YOLO landed and this card is the chosen one. */
  yoloWinner?: boolean;
}

export default function FoodCard({
  data,
  cardIdx,
  lang,
  selectedDay,
  todayIndex,
  voteCount,
  maxVotes,
  onImageClick,
  onCardClick,
  yoloHighlighted = false,
  yoloWinner = false,
}: FoodCardProps) {
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

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
    availabilityNotes,
  } = data;

  const isVoteable = todayIndex >= 0 && selectedDay === todayIndex && !isOutdated && !isAhead;
  const isLeader = voteCount > 0 && voteCount === maxVotes;

  return (
    <Wrapper3D maxRotation={6} translateZ={18} className="food-card-3d-wrapper">
    <article
      className={`food-card${mainDish ? " clickable" : ""}${isVoteable ? " voteable" : ""}${isOutdated ? " outdated" : ""}${isAhead ? " ahead" : ""}${yoloHighlighted ? " yolo-active" : ""}${yoloWinner ? " yolo-winner" : ""}`}
      style={{ animationDelay: `${cardIdx * 75}ms` }}
      onClick={mainDish ? () => onCardClick(canteenName) : undefined}
      data-yolo-card-key={canteenName}
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
        onClick={e => { e.stopPropagation(); if (mainDish) onImageClick(data); }}
      >
        <div className="card-image-circle">
          {/* An empty path means the server found no plate for this dish. Go
              straight to the placeholder rather than letting the browser
              request the document URL and fail. */}
          {imgError || !imagePath ? (
            <div className="image-placeholder">
              {canteenName.charAt(0)}
            </div>
          ) : (
            <>
              {!imgLoaded && <div className="image-shimmer" />}
              <img
                // Remount per dish so the ref below re-runs and imgLoaded is
                // never carried over from the previous day's plate.
                key={imagePath}
                src={imagePath}
                alt={mainDish?.dish || "Matrett"}
                className={`food-image${imgLoaded ? " loaded" : ""}`}
                loading="lazy"
                // .food-image is opacity: 0 until `loaded`, so a plate whose
                // onLoad never fires stays invisible forever — and a cached
                // image can finish decoding before React attaches the handler.
                // That race was unloseable while these were 1.5 MB PNGs and is
                // near-certain now they are 24 KB WebPs off a CDN, so ask the
                // element whether it already finished instead of only listening.
                ref={el => { if (el?.complete && el.naturalWidth > 0) setImgLoaded(true); }}
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

        {mainAllergens && mainAllergens.length > 0 && (
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
        <div className="side-dishes-header">
          <span className="side-dishes-title">{lang === "no" ? "Andre retter" : "Other dishes"}</span>
          {availabilityNotes && availabilityNotes.length > 0 && (
            <span className="availability-pills">
              {availabilityNotes.map((note, i) => (
                <span key={i} className="availability-pill" title={note}>{note}</span>
              ))}
            </span>
          )}
        </div>
        <div className="side-dish-list">
          {sideDishes && sideDishes.length > 0 ? sideDishes.map((item, idx) => (
            <div key={idx} className="side-dish-item">
              <span className="side-dish-text">{item.dish}</span>
              {item.allergens?.length > 0 && (
                <span className="side-allergens">{item.allergens.map(a => lang === "no" ? (ALLERGEN_ABBREV_NO[a.name] || a.name.slice(0, 2)) : (ALLERGEN_ABBREV[a.name] || a.name.slice(0, 2))).join(" ")}</span>
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
