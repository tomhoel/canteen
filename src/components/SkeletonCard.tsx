/**
 * The placeholder shown in a card's place while the menu is being fetched.
 *
 * It mirrors FoodCard's element structure and reuses its class names —
 * `.food-card-3d-wrapper > .food-card > .card-image-wrapper / .card-content /
 * .card-bottom` — instead of describing a box of its own. That is deliberate.
 * `.skeleton-card` used to carry a private copy of `.food-card`'s *desktop*
 * rules, which meant it never received any of the `(max-width: 768px)`
 * overrides the real card gets: on a phone the placeholder stood 504px tall
 * where the card replacing it was 233px, and every card jumped when it loaded.
 * Sharing the classes makes that kind of drift impossible rather than merely
 * unlikely.
 *
 * The image slot reuses `.image-shimmer`, the very same placeholder a loaded
 * card shows while its own plate is still downloading, so the transition from
 * "no data" to "data, no picture yet" is continuous.
 */
export function SkeletonCard({ delay = 0 }: { delay?: number }) {
  return (
    <div className="food-card-3d-wrapper">
      <article
        className="food-card skeleton-card"
        style={{ animationDelay: `${delay}ms` }}
        aria-hidden="true"
      >
        <div className="card-image-wrapper">
          <div className="card-image-circle">
            <div className="image-shimmer" />
          </div>
        </div>

        <div className="card-content">
          <div className="card-header">
            <div className="canteen-name">
              <span className="skeleton-line skeleton-line-canteen" />
            </div>
            <h3 className="dish-name">
              <span className="skeleton-line skeleton-line-dish" />
            </h3>
          </div>
          <div className="dish-meta-row">
            <div className="allergens-row">
              <span className="skeleton-line skeleton-line-chip" />
              <span className="skeleton-line skeleton-line-chip" />
            </div>
          </div>
        </div>

        <div className="card-bottom">
          <div className="side-dishes-header">
            <span className="side-dishes-title">
              <span className="skeleton-line skeleton-line-label" />
            </span>
          </div>
          <div className="side-dish-list">
            <div className="side-dish-item">
              <span className="skeleton-line skeleton-line-side" />
            </div>
            <div className="side-dish-item">
              <span className="skeleton-line skeleton-line-side skeleton-line-side-short" />
            </div>
            <div className="side-dish-item">
              <span className="skeleton-line skeleton-line-side" />
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}

// Deliberately no default export. This module used to have one — a *group* of
// three cards — one character away in an import statement from the single card
// beside it. The route's pending component imported the group, called it
// `SkeletonCard`, and rendered it three times: nine cards on screen. A named
// export only is what makes that mistake unrepresentable rather than merely
// fixed.
