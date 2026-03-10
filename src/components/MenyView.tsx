import { useState } from "react";
import type { MenyResponse, MenyIngredientMatch, MenyProduct } from "@/lib/types";

interface MenyViewProps {
  meny: MenyResponse;
  lang: "no" | "en";
  onBack: () => void;
}

function ProductCard({ match, lang, index }: { match: MenyIngredientMatch; lang: "no" | "en"; index: number }) {
  const [showAlts, setShowAlts] = useState(false);
  const hasAlts = match.alternatives.length > 0;
  const recipeDesc = [match.recipeAmount, match.recipeUnit].filter(Boolean).join(" ");

  return (
    <div className="mv-row" style={{ animationDelay: `${index * 40}ms` }}>
      <ProductLink url={match.product?.productUrl}>
        <div className={`mv-card${match.outOfStock ? " mv-oos" : ""}`}>
          <div className="mv-thumb">
            {match.product?.imageUrl ? (
              <img
                src={match.product.imageUrl}
                alt={match.product.name}
                className="mv-thumb-img"
                loading="lazy"
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <span className="mv-thumb-letter">{match.ingredient.charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div className="mv-detail">
            <span className="mv-name">{match.ingredient}</span>
            <span className="mv-product">
              {match.product!.name}
              {match.product!.brand ? ` \u00B7 ${match.product!.brand}` : ""}
              {match.product!.weight ? ` \u00B7 ${match.product!.weight}` : ""}
            </span>
            {match.outOfStock && (
              <span className="mv-oos-label">{lang === "no" ? "Ikke tilgjengelig" : "Unavailable"}</span>
            )}
          </div>
          <div className="mv-right">
            {recipeDesc && <span className="mv-qty">{recipeDesc}</span>}
            <span className="mv-price">
              {match.outOfStock ? "\u2013" : <>{match.product!.price} <span className="mv-kr">kr</span></>}
            </span>
          </div>
        </div>
      </ProductLink>

      {hasAlts && (
        <button className="mv-alts-btn" onClick={() => setShowAlts(!showAlts)}>
          {showAlts
            ? (lang === "no" ? "Skjul" : "Hide")
            : (lang === "no" ? `${match.alternatives.length} alternativer` : `${match.alternatives.length} alternatives`)}
        </button>
      )}

      {hasAlts && showAlts && (
        <div className="mv-alts">
          {match.alternatives.map(alt => (
            <ProductLink key={alt.ean} url={alt.productUrl}>
              <div className="mv-alt">
                <div className="mv-alt-thumb">
                  {alt.imageUrl ? (
                    <img src={alt.imageUrl} alt={alt.name} className="mv-thumb-img" loading="lazy"
                      onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  ) : null}
                </div>
                <span className="mv-alt-name">
                  {alt.name}{alt.brand ? ` \u00B7 ${alt.brand}` : ""}{alt.weight ? ` \u00B7 ${alt.weight}` : ""}
                </span>
                <span className="mv-alt-price">{alt.price} <span className="mv-kr">kr</span></span>
              </div>
            </ProductLink>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductLink({ url, children }: { url: string | null | undefined; children: React.ReactNode }) {
  if (!url) return <>{children}</>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="mv-link">{children}</a>
  );
}

export default function MenyView({ meny, lang, onBack }: MenyViewProps) {
  const { matches, totalPrice, matchedCount, totalCount, allMatched, storeName } = meny;
  const outOfStockCount = matches.filter(m => m.matched && m.outOfStock).length;
  const trueAllMatched = allMatched && outOfStockCount === 0;

  const matched = matches.filter(m => m.matched);
  const unmatched = matches.filter(m => !m.matched);
  const toBuy = matched.filter(m => !m.pantryStaple);
  const pantry = matched.filter(m => m.pantryStaple);

  return (
    <div className="mv">
      <button className="mv-back" onClick={onBack}>
        <span className="mv-back-arrow">{"\u2039"}</span>
        <span>{lang === "no" ? "Tilbake til oppskrift" : "Back to recipe"}</span>
      </button>

      {/* Header */}
      <div className="mv-header">
        <div>
          <span className="mv-store">{storeName}</span>
          <span className={`mv-count${trueAllMatched ? "" : " partial"}`}>
            {matchedCount}/{totalCount} {lang === "no" ? "varer" : "items"}
          </span>
        </div>
        <span className="mv-total">~{Math.round(totalPrice)} kr</span>
      </div>

      {/* Products to buy */}
      {toBuy.length > 0 && (
        <div className="mv-list">
          {toBuy.map((match, i) => (
            <ProductCard key={match.ingredient} match={match} lang={lang} index={i} />
          ))}
        </div>
      )}

      {/* Pantry staples */}
      {pantry.length > 0 && (
        <div className="mv-section">
          <span className="mv-section-label">
            {lang === "no" ? "Har trolig hjemme" : "Likely at home"}
          </span>
          <div className="mv-list mv-list--pantry">
            {pantry.map((match, i) => (
              <ProductCard key={match.ingredient} match={match} lang={lang} index={toBuy.length + i} />
            ))}
          </div>
        </div>
      )}

      {/* Unmatched */}
      {unmatched.length > 0 && (
        <div className="mv-section">
          <span className="mv-section-label">
            {lang === "no" ? "Ikke funnet" : "Not found"}
          </span>
          <div className="mv-chips">
            {unmatched.map(m => (
              <span key={m.ingredient} className="mv-chip">{m.ingredient}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
