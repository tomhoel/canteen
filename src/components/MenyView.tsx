import type { MenyResponse } from "@/lib/types";

interface MenyViewProps {
  meny: MenyResponse;
  lang: "no" | "en";
  onBack: () => void;
}

export default function MenyView({ meny, lang, onBack }: MenyViewProps) {
  const { matches, totalPrice, matchedCount, totalCount, allMatched, storeName } = meny;
  const matched = matches.filter(m => m.matched);
  const unmatched = matches.filter(m => !m.matched);

  return (
    <div className="meny-view">
      <button className="meny-back" onClick={onBack}>
        <span className="meny-back-arrow">{"\u2039"}</span>
        <span>{lang === "no" ? "Tilbake til oppskrift" : "Back to recipe"}</span>
      </button>

      {/* Status card */}
      <div className="meny-status-card">
        <div className="meny-status-header">
          <div className="meny-store-badge">MENY</div>
          <div className="meny-status-info">
            <span className="meny-store-name">{storeName}</span>
            <span className={`meny-confidence-badge${allMatched ? " meny-confidence-full" : " meny-confidence-partial"}`}>
              {allMatched
                ? (lang === "no" ? "Alle ingredienser funnet!" : "All ingredients found!")
                : (lang === "no" ? `${matchedCount} av ${totalCount} funnet` : `${matchedCount} of ${totalCount} found`)}
            </span>
          </div>
        </div>
        <div className="meny-status-total">
          <span className="meny-total-label">{lang === "no" ? "Estimert totalpris" : "Estimated total"}</span>
          <span className="meny-total-price">~{Math.round(totalPrice)} kr</span>
        </div>
      </div>

      {/* Product list */}
      {matched.length > 0 && (
        <div className="meny-product-list">
          {matched.map((match, i) => (
            <div key={match.ingredient} className="meny-product-card" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="meny-product-img-wrap">
                {match.product?.imageUrl ? (
                  <img
                    src={match.product.imageUrl}
                    alt={match.product.name}
                    className="meny-product-img"
                    loading="lazy"
                    onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <span className="meny-product-img-placeholder">{"\uD83D\uDED2"}</span>
                )}
              </div>
              <div className="meny-product-details">
                <span className="meny-product-ingredient">{match.ingredient}</span>
                <span className="meny-product-name">{match.product!.name}</span>
                <span className="meny-product-meta">
                  {match.product!.brand}
                  {match.product!.weight ? ` \u00B7 ${match.product!.weight}` : ""}
                </span>
              </div>
              <div className="meny-product-price-col">
                <span className="meny-product-price">{match.product!.price} kr</span>
                {match.product!.pricePerUnit && (
                  <span className="meny-product-unit-price">{match.product!.pricePerUnit}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Unmatched section */}
      {unmatched.length > 0 && (
        <div className="meny-not-found">
          <span className="meny-not-found-label">
            {lang === "no" ? "Ikke funnet hos Meny" : "Not found at Meny"}
          </span>
          <div className="meny-not-found-list">
            {unmatched.map(m => (
              <span key={m.ingredient} className="meny-not-found-item">{m.ingredient}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
