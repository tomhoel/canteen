import { useState, useEffect, memo } from "react";
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

/**
 * The plate, and its entrance.
 *
 * This was a `motion.img` running a 240/24/0.7 spring on x and scale plus a
 * 280ms opacity tween. That spring's damping ratio is 0.93 — over-damped, so
 * it never overshot, and a cubic-bezier reproduces the curve exactly. What the
 * spring actually bought was the shape of the curve, not the physics.
 *
 * Two details this has to keep, both easy to lose:
 *
 * 1. It is a separate component so that `key={imagePath}` remounts *it*. The
 *    state below then starts at false again, which is what re-fires the
 *    entrance on a day change. FoodCard itself does not remount, so holding
 *    this state up there would fade the plate in once, on the first day
 *    viewed, and never again.
 *
 * 2. A `transition`, not an `animation`. The mobile block sets
 *    `animation: none !important` on `.food-image` (it is aimed at the
 *    infinite `gentleFloat`, but it is a blanket), so a keyframe entrance here
 *    would be silently discarded on exactly the devices that matter most. A
 *    transition is untouched by that rule, and an inline style outranks it.
 *
 * The phone gets the fade only, and always did: the mobile stylesheet used to
 * discard the plate's transform with an `!important`, so the parallax has
 * never once rendered on a phone. Three plates x two animated values is six
 * spring integrators writing to element.style every frame of every swipe, for
 * a movement that was thrown away.
 */
function PlateImage({
  src,
  alt,
  isDesktop,
  priority,
  isInitial = false,
  onLoad,
  onError,
}: {
  src: string;
  alt: string;
  isDesktop: boolean;
  priority: boolean;
  isInitial?: boolean;
  onLoad: () => void;
  onError: () => void;
}) {
  const [shown, setShown] = useState(!isInitial);

  useEffect(() => {
    if (!isInitial) return;
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [isInitial]);

  return (
    <img
      src={src}
      alt={alt}
      className="food-image loaded"
      style={{
        opacity: shown ? 1 : 0,
        // Desktop initial load only: the plate slides 28px in from the right and settles out of a 1.1 scale.
        transform: isDesktop && isInitial
          ? shown
            ? "translateX(0) scale(1)"
            : "translateX(28px) scale(1.1)"
          : undefined,
        transition: isInitial
          ? isDesktop
            ? "opacity 280ms linear, transform 460ms cubic-bezier(0.22, 1, 0.36, 1)"
            : "opacity 280ms linear"
          : "none",
      }}
      loading="eager"
      decoding="async"
      fetchPriority={priority ? "high" : undefined}
      onLoad={onLoad}
      onError={onError}
    />
  );
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
  /** True strictly on the first initial app load, enabling card launch entrance animations. */
  isInitial?: boolean;
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
  isInitial = false,
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
    displayDishName,
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
      style={
        isInitial
          ? {
              // The row cascades: card 0 leads, each following card starts 55ms
              // later and takes 40ms longer, so they do not move at the same rate.
              animationDelay: `${cardIdx * 55}ms`,
              animationDuration: `${0.28 + cardIdx * 0.04}s`,
            }
          : undefined
      }
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
              <PlateImage
                key={imagePath}
                src={imagePath}
                alt={mainDish?.dish || "Matrett"}
                isDesktop={isDesktop}
                priority={cardIdx === 0}
                isInitial={isInitial}
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
        The third rate, on a desktop: text rises 8px and fades the last of the
        way in, faster than either the card or the plate, so it settles first.
        It is `cardContentEnter` in the stylesheet now rather than a spring
        here, but `key` stays exactly where it was on initial launch.
        On subsequent day changes, key is undefined so React does not discard
        and rebuild the content node.

        Off on a phone, which is why the rule sits behind `min-width: 769px`.
        y and opacity are compositor properties, so the animation itself is
        cheap — but `.card-content` has no `will-change`, so WebKit promotes it
        to its own layer for the duration and drops it again afterwards, and
        the layer it has to rasterise is ~190x150 CSS px of pure text at 3x.
        Three cards, three promote-and-discard cycles, on every day change.
      */}
      <div key={isInitial ? selectedDay : undefined} className="card-content">
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
          {/* The shortened headline where there is one, the scraped name where
            there is not. Everything else on this card — the lightbox, the
            action sheet, the recipe — still uses mainDish.dish. */}
        <h3 className="dish-name">{displayDishName || mainDish?.dish || ("Ingen meny")}</h3>
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
      </div>

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
