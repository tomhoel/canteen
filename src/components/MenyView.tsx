import type { MenyResponse } from "@/lib/types";

interface MenyViewProps {
  meny: MenyResponse;
  lang: "no" | "en";
  onBack: () => void;
}

export default function MenyView({ meny, lang, onBack }: MenyViewProps) {
  const { matches, totalPrice, matchedCount, totalCount, allMatched, storeName } = meny;
  const outOfStockCount = matches.filter(m => m.matched && m.outOfStock).length;
  const trueAllMatched = allMatched && outOfStockCount === 0;
  const matched = matches.filter(m => m.matched);
  const unmatched = matches.filter(m => !m.matched);

  return (
    <div className="meny-view">
      <button className="meny-back" onClick={onBack}>
        <span className="meny-back-arrow">{"\u2039"}</span>
        <span>{lang === "no" ? "Tilbake til oppskrift" : "Back to recipe"}</span>
      </button>

      {/* Summary */}
      <div className="meny-summary">
        <div className="meny-summary-top">
          <span className="meny-summary-store">{storeName}</span>
          <span className={`meny-summary-match${trueAllMatched ? "" : " partial"}`}>
            {trueAllMatched
              ? (lang === "no" ? `${matchedCount} av ${totalCount}` : `${matchedCount} of ${totalCount}`)
              : `${matchedCount}/${totalCount}`}
          </span>
        </div>
        <span className="meny-summary-total">~{Math.round(totalPrice)} kr</span>
      </div>

      {/* Product list */}
      {matched.length > 0 && (
        <div className="meny-product-list">
          {matched.map((match, i) => (
            <div key={match.ingredient} className={`meny-product-card${match.outOfStock ? " out-of-stock" : ""}`} style={{ animationDelay: `${i * 50}ms` }}>
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
                  <span className="meny-product-img-placeholder">{match.ingredient.charAt(0).toUpperCase()}</span>
                )}
              </div>
              <div className="meny-product-details">
                <span className="meny-product-ingredient">{match.ingredient}</span>
                <span className="meny-product-name">
                  {match.product!.name}
                  {match.product!.brand ? ` \u00B7 ${match.product!.brand}` : ""}
                  {match.product!.weight ? ` \u00B7 ${match.product!.weight}` : ""}
                </span>
                {match.outOfStock && (
                  <span className="meny-out-of-stock-badge">
                    {lang === "no" ? "Utilgjengelig" : "Out of stock"}
                  </span>
                )}
              </div>
              <span className="meny-product-price">
                {match.outOfStock ? "–" : `${match.product!.price} kr`}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Unmatched */}
      {unmatched.length > 0 && (
        <div className="meny-not-found">
          <span className="meny-not-found-label">
            {lang === "no" ? "Ikke funnet" : "Not found"}
          </span>
          {unmatched.map(m => (
            <span key={m.ingredient} className="meny-not-found-item">{m.ingredient}</span>
          ))}
        </div>
      )}
    </div>
  );
}
