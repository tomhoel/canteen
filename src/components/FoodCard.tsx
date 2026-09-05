import { useState, memo } from "react";
import { motion } from "motion/react";
import { Users, Clock } from "lucide-react";
import { ALLERGEN_COLORS, ALLERGEN_NAMES_NO, ALLERGEN_ABBREV_NO, getCanteenMetadata } from "@/lib/constants";
import type { CanteenDayItem } from "@/lib/types";
import { Wrapper3D } from "@/components/ui/3d-wrapper";
import { markImageCached } from "@/lib/imageCache";
import { useIsDesktop } from "@/lib/useIsDesktop";

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

function getCountryAdjective(country: string): string {
  const key = country.toLowerCase().trim();
  return COUNTRY_ADJECTIVES[key]?.["no"] || country;
}

interface FoodCardProps {
  data: CanteenDayItem;
  cardIdx: number;
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

const FoodCard = memo(function FoodCard({
  data,
  cardIdx,
  selectedDay,
  todayIndex,
  voteCount,
  maxVotes,
  onImageClick,
  onCardClick,
  yoloHighlighted = false,
  yoloWinner = false,
}: FoodCardProps) {
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

  const [imgError, setImgError] = useState(false);
  const isDesktop = useIsDesktop();

  const isVoteable = todayIndex >= 0 && selectedDay === todayIndex && !isOutdated && !isAhead;
  const isLeader = voteCount > 0 && voteCount === maxVotes;

  return (
    <Wrapper3D maxRotation={6} translateZ={18} className="food-card-3d-wrapper">
    <article
      className={`food-card${mainDish ? " clickable" : ""}${isVoteable ? " voteable" : ""}${isOutdated ? " outdated" : ""}${isAhead ? " ahead" : ""}${yoloHighlighted ? " yolo-active" : ""}${yoloWinner ? " yolo-winner" : ""}`}
      style={{
        // The row cascades: card 0 leads, each following card starts 55ms
        // later and takes 40ms longer, so they do not move at the same rate.
        animationDelay: `${cardIdx * 55}ms`,
        animationDuration: `${0.28 + cardIdx * 0.04}s`,
      }}
      onClick={mainDish ? () => onCardClick(canteenName) : undefined}
      data-yolo-card-key={canteenName}
    >
      {isVoteable && voteCount > 0 && (
        <div className={`vote-pip${isLeader ? " leader" : ""}`}>
          <Users size={12} strokeWidth={2.4} className="vote-pip-icon" />
          <span>{voteCount}</span>
        </div>
      )}
      <div
        className="card-image-wrapper"
        onClick={e => { e.stopPropagation(); if (mainDish) onImageClick(data); }}
      >
        <div className="card-image-circle">
          {imgError || !imagePath ? (
            <div className="image-placeholder">
              {canteenName.charAt(0)}
            </div>
          ) : (
            <div className="plate-float-container">
              {/*
                On a desktop the plate carries its own spring, softer and
                slower than the one moving the day around it (240/24 against
                300/30), so the picture lags fractionally behind the card it
                sits in and the two read as separate depths.

                On a phone it only fades. Not a new concession — the mobile
                stylesheet has been discarding this transform all along with an
                `!important`, so the parallax has never once rendered on a
                phone. What is new is that we stop paying for it: three plates
                x two animated values is six spring integrators writing to
                element.style every frame of every swipe, for a movement that
                was thrown away. Asking for nothing looks identical and costs
                nothing.
              */}
              <motion.img
                key={imagePath}
                src={imagePath}
                alt={mainDish?.dish || "Matrett"}
                className="food-image loaded"
                initial={isDesktop ? { opacity: 0, scale: 1.1, x: 28 } : { opacity: 0 }}
                animate={isDesktop ? { opacity: 1, scale: 1, x: 0 } : { opacity: 1 }}
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
                onLoad={() => markImageCached(imagePath)}
                onError={() => setImgError(true)}
              />
            </div>
          )}
        </div>
        {isOutdated && (
          <div className="stale-image-badge">
            {`Uke ${canteenWeekNum}`}
          </div>
        )}
        <span className="click-hint">{"Klikk for større"}</span>
        {origin && mainDish && (
          <div className="origin-pip">
            <span className="emoji-flag">{origin.code.toUpperCase().split("").map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join("")}</span>
            <img
              className="image-flag"
              src={`https://flagcdn.com/w20/${origin.code.toLowerCase()}.png`}
              alt={origin.country}
              width={20}
              height={15}
              loading="lazy"
              decoding="async"
            />
            <span className="origin-pip-name">{getCountryAdjective(origin.country)}</span>
          </div>
        )}
      </div>
      {/*
        The third rate. Text rises 8px and fades the last of the way in on a
        stiffer, lighter spring than either the card or the plate, so it
        settles first. No scale here, deliberately — scaling a box of text is
        the one thing WebKit has to re-rasterise glyph by glyph, and it is why
        this motion was removed rather than tuned. y and opacity are both
        compositor properties and cost the phone nothing.
      */}
      <motion.div
        key={selectedDay}
        initial={{ opacity: 0.5, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 30, mass: 0.6 }}
        className="card-content"
      >
        <div className="card-header">
          {(() => {
            const meta = getCanteenMetadata(canteenName);
            return (
              <div className="canteen-name">
                <span>{meta.name}</span>
                {isAhead && (
                  <span className="ahead-tag">{`Uke ${canteenWeekNum}`}</span>
                )}
              </div>
            );
          })()}
          <h3 className="dish-name">{mainDish?.dish || ("Ingen meny")}</h3>
        </div>

        {mainAllergens && mainAllergens.length > 0 && (
          <div className="dish-meta-row">
            <div className="allergens-row">
              {mainAllergens.map((a, aIdx) => {
                const displayName = (ALLERGEN_NAMES_NO[a.name] || a.name);
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
      </motion.div>

      {isOutdated && (
        <div className="stale-banner">
          <Clock size={16} className="stale-banner-icon" />
          <div className="stale-banner-text">
            <strong>{"Ikke oppdatert"}</strong>
            <span>{`Viser meny for uke ${canteenWeekNum}`}</span>
          </div>
        </div>
      )}
      <div className="card-bottom">
        <div className="side-dishes-header">
          <span className="side-dishes-title">{"Andre retter"}</span>
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
                <span className="side-allergens">{item.allergens.map(a => (ALLERGEN_ABBREV_NO[a.name] || a.name.slice(0, 2))).join(" ")}</span>
              )}
            </div>
          )) : (
            <div className="side-dish-item" style={{ justifyContent: "center", color: "var(--text-muted)" }}>
              {"Ingen andre retter"}
            </div>
          )}
        </div>
      </div>
    </article>
    </Wrapper3D>
  );
});

export default FoodCard;
