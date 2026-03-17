export function SkeletonCard({ delay = 0 }: { delay?: number }) {
  return (
    <article
      className="skeleton-card"
      style={{ animationDelay: `${delay}ms` }}
      aria-hidden="true"
    >
      <div className="skeleton-circle" />
      <div className="skeleton-content">
        <div className="skeleton-block skeleton-canteen" />
        <div className="skeleton-block skeleton-dish" />
        <div className="skeleton-divider" />
        <div className="skeleton-block skeleton-side" />
        <div className="skeleton-block skeleton-side skeleton-side-short" />
        <div className="skeleton-block skeleton-side" />
      </div>
    </article>
  );
}

export default function SkeletonCards() {
  return (
    <div className="cards-container" aria-label="Loading menus…">
      <div className="cards-animated-wrapper">
        <SkeletonCard delay={0} />
        <SkeletonCard delay={75} />
        <SkeletonCard delay={150} />
      </div>
    </div>
  );
}
