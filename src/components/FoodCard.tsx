import { useState, useLayoutEffect, useRef, memo } from "react";
import { Milk, Fish, Wheat, Egg, Nut, Shrimp, Shell, Bean, Leaf, Sprout, Droplet, Flower, Wine, CircleAlert, type LucideIcon } from "lucide-react";
import { ALLERGEN_NAMES_NO, getCanteenMetadata } from "@/lib/constants";
import type { CanteenDayItem } from "@/lib/types";
import { markImageCached } from "@/lib/imageCache";

const COUNTRY_ADJECTIVES: Record<string, string> = {
  turkey: "Tyrkisk",
  italy: "Italiensk",
  mexico: "Meksikansk",
  japan: "Japansk",
  china: "Kinesisk",
  india: "Indisk",
  thailand: "Thailandsk",
  usa: "Amerikansk",
  "united states": "Amerikansk",
  france: "Fransk",
  spain: "Spansk",
  greece: "Gresk",
  vietnam: "Vietnamesisk",
  korea: "Koreansk",
  morocco: "Marokkansk",
  brazil: "Brasiliansk",
  peru: "Peruansk",
  sweden: "Svensk",
  norway: "Norsk",
  denmark: "Dansk",
  "united kingdom": "Britisk",
  uk: "Britisk",
  lebanon: "Libanesisk",
  indonesia: "Indonesisk",
  philippines: "Filippinsk",
  portugal: "Portugisisk",
  poland: "Polsk",
  germany: "Tysk",
  netherlands: "Nederlandsk",
  argentina: "Argentinsk",
  colombia: "Kolombiansk",
  malaysia: "Malaysisk",
  pakistan: "Pakistansk",
  hungary: "Ungarsk",
  austria: "Østerriksk",
  barbados: "Barbadisk",
};

/**
 * One icon per allergen, from the app's own icon set. The icon is what tells
 * allergens apart at a glance; the name (on main dishes, and as a tooltip and
 * screen-reader text on side dishes) is what makes it certain.
 */
const ALLERGEN_ICONS: Record<string, LucideIcon> = {
  Milk: Milk,
  Fish: Fish,
  Gluten: Wheat,
  Egg: Egg,
  Nuts: Nut,
  Peanuts: Nut,
  Shellfish: Shrimp,
  Molluscs: Shell,
  Soya: Bean,
  Celery: Leaf,
  "Sesame seeds": Sprout,
  Mustard: Droplet,
  Lupin: Flower,
  Sulphites: Wine,
};

function getCountryAdjective(country: string): string {
  const key = country.toLowerCase().trim();
  return COUNTRY_ADJECTIVES[key] || country;
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
  priority,
  isInitial = false,
  onLoad,
  onError,
}: {
  src: string;
  alt: string;
  priority: boolean;
  isInitial?: boolean;
  onLoad: () => void;
  onError: () => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [shown, setShown] = useState(false);
  // Already in the HTTP cache when this mounted: show it at once, no reveal.
  // Decided before first paint so a cached plate never flashes the shimmer.
  const [cached, setCached] = useState(false);

  useLayoutEffect(() => {
    const el = imgRef.current;
    if (el?.complete && el.naturalWidth > 0) {
      setCached(true);
      setShown(true);
    }
  }, []);

  // The reveal waits for the bytes (the old fade ran on a timer and showed
  // the plate half-painted, top to bottom). decode() makes the first frame of
  // the fade a finished picture.
  const reveal = () => {
    const el = imgRef.current;
    (el?.decode?.() ?? Promise.resolve()).catch(() => {}).then(() => setShown(true));
    onLoad();
  };

  const animate = !cached || isInitial;

  return (
    <>
      <span className={`image-shimmer${shown ? " loaded" : ""}`} aria-hidden="true" />
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className="food-image loaded"
        style={{
          opacity: shown ? 1 : 0,
          // A plate that was not in the cache arrives with a quick fade and a
          // 4% settle, and then hands the transform back to the stylesheet.
          // Short on purpose: it is the food arriving, not a performance.
          transform: shown ? undefined : "scale(0.96)",
          transition: animate
            ? "opacity 180ms ease-out, transform 240ms cubic-bezier(0.22, 1, 0.36, 1)"
            : "none",
        }}
        loading="eager"
        decoding="async"
        fetchPriority={priority ? "high" : undefined}
        onLoad={reveal}
        onError={onError}
      />
    </>
  );
}

interface FoodCardProps {
  data: CanteenDayItem;
  cardIdx: number;
  /** Opens the enlarged plate. The whole card is the target. */
  onImageClick: (data: CanteenDayItem) => void;
  /** True strictly on the first initial app load, enabling card launch entrance animations. */
  isInitial?: boolean;
}

const FoodCard = memo(function FoodCard({
  data,
  cardIdx,
  onImageClick,
  isInitial = false,
}: FoodCardProps) {
  const {
    canteenName,
    mainDish,
    sideDishes,
    mainAllergens,
    imagePath,
    highResImagePath,
    isOutdated,
    isAhead,
    canteenWeekNum,
    origin,
    displayDishName,
    availabilityNotes,
  } = data;

  const [imgError, setImgError] = useState(false);
  // The thumb is written best-effort after the full plate, so it can be missing
  // while the plate exists. Fall back to the full image before the letter.
  const [useFullPlate, setUseFullPlate] = useState(false);
  const plateSrc = (useFullPlate && highResImagePath) || imagePath || "";

  // A tap anywhere on the card opens its plate; a card with no plate to show does nothing.
  const canOpen = !!mainDish && !!imagePath && !imgError;

  return (
    <div className="food-card-3d-wrapper">
    <article
      className={`food-card${canOpen ? " clickable" : ""}${isOutdated ? " outdated" : ""}${isAhead ? " ahead" : ""}`}
      style={
        isInitial
          ? {
              // The opening entrance staggers the three cards 50ms apart.
              animationDelay: `${cardIdx * 50}ms`,
            }
          : undefined
      }
      onClick={canOpen ? () => onImageClick(data) : undefined}
    >
      <div className="card-image-wrapper">
        <div className="card-image-circle" data-plate={canteenName}>
          {imgError || !imagePath ? (
            <div className="image-placeholder">
              {canteenName.charAt(0)}
            </div>
          ) : (
            <div className="plate-float-container">
              <PlateImage
                key={plateSrc}
                src={plateSrc}
                alt={mainDish?.dish || "Matrett"}
                priority={cardIdx === 0}
                isInitial={isInitial}
                onLoad={() => markImageCached(plateSrc)}
                onError={() =>
                  !useFullPlate && highResImagePath && highResImagePath !== imagePath
                    ? setUseFullPlate(true)
                    : setImgError(true)
                }
              />
            </div>
          )}
        </div>
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
      <div className="card-content">
        <div className="card-header">
          {(() => {
            const meta = getCanteenMetadata(canteenName);
            return (
              <div className="canteen-name">
                {meta.logo ? (
                  <>
                    <img className="canteen-logo" data-canteen={meta.id} src={meta.logo} alt={meta.name} decoding="async" />
                    {/* Where to walk to, beside who is cooking: "Bygg M", not "Bygg M, 2. etasje". */}
                    <span className="canteen-building">{meta.building.split(",")[0]}</span>
                  </>
                ) : (
                  <span>{meta.name}</span>
                )}
                {isAhead && (
                  <span className="ahead-tag">{`Uke ${canteenWeekNum}`}</span>
                )}
                {isOutdated && canteenWeekNum && (
                  <span className="stale-week" title="Ikke oppdatert">{`· Uke ${canteenWeekNum}`}</span>
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
              {mainAllergens.map((a) => {
                const Icon = ALLERGEN_ICONS[a.name] ?? CircleAlert;
                return (
                  <span key={a.id} className="allergen-chip">
                    <Icon size={12} strokeWidth={2} aria-hidden="true" />
                    {ALLERGEN_NAMES_NO[a.name] || a.name}
                  </span>
                );
              })}
            </div>
          </div>
        )}

      </div>

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
                <span className="side-allergens">
                  {item.allergens.map((a) => {
                    const Icon = ALLERGEN_ICONS[a.name] ?? CircleAlert;
                    const name = ALLERGEN_NAMES_NO[a.name] || a.name;
                    return (
                      <span key={a.id ?? a.name} className="side-allergen" title={name}>
                        <Icon size={13} strokeWidth={2} aria-hidden="true" />
                        <span className="sr-only">{name}</span>
                      </span>
                    );
                  })}
                </span>
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
    </div>
  );
});

export default FoodCard;
