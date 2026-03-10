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

  const card = (
    <div
      className={`meny-card${match.outOfStock ? " oos" : ""}${match.product?.productUrl ? " has-link" : ""}`}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="meny-card-thumb">
        {match.product?.imageUrl ? (
          <img
            src={match.product.imageUrl}
            alt={match.product.name}
            className="meny-card-img"
            loading="lazy"
            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <span className="meny-card-initial">{match.ingredient.charAt(0).toUpperCase()}</span>
        )}
      </div>
      <div className="meny-card-info">
        <span className="meny-card-ingredient">
          {match.ingredient}
          {recipeDesc && <span className="meny-card-qty">{recipeDesc}</span>}
        </span>
        <span className="meny-card-product">
          {match.product!.name}
          {match.product!.brand ? ` \u00B7 ${match.product!.brand}` : ""}
          {match.product!.weight ? ` \u00B7 ${match.product!.weight}` : ""}
        </span>
        {match.outOfStock && (
          <span className="meny-card-oos">{lang === "no" ? "Ikke tilgjengelig" : "Unavailable"}</span>
        )}
      </div>
      <span className="meny-card-price">
        {match.outOfStock ? "\u2013" : <>{match.product!.price}<span className="meny-kr">kr</span></>}
      </span>
    </div>
  );

  return (
    <div className="meny-row" style={{ animationDelay: `${index * 40}ms` }}>
      {match.product?.productUrl ? (
        <a href={match.product.productUrl} target="_blank" rel="noopener noreferrer" className="meny-link">
          {card}
        </a>
      ) : (
        card
      )}

      {hasAlts && (
        <button className="meny-alts-pill" onClick={() => setShowAlts(!showAlts)}>
          {showAlts ? "\u2212" : `+${match.alternatives.length}`}
        </button>
      )}

      {hasAlts && showAlts && (
        <div className="meny-alts">
          {match.alternatives.map(alt => (
            <AltItem key={alt.ean} product={alt} />
          ))}
        </div>
      )}
    </div>
  );
}

function AltItem({ product }: { product: MenyProduct }) {
  const inner = (
    <div className="meny-alt">
      <div className="meny-alt-thumb">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="meny-alt-img" loading="lazy"
            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : null}
      </div>
      <span className="meny-alt-label">
        {product.name}
        {product.brand ? ` \u00B7 ${product.brand}` : ""}
        {product.weight ? ` \u00B7 ${product.weight}` : ""}
      </span>
      <span className="meny-alt-price">{product.price}<span className="meny-kr">kr</span></span>
    </div>
  );

  return product.productUrl ? (
    <a href={product.productUrl} target="_blank" rel="noopener noreferrer" className="meny-link">{inner}</a>
  ) : inner;
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
    <div className="meny-view">
      <button className="meny-back" onClick={onBack}>
        <span className="meny-back-arrow">{"\u2039"}</span>
        <span>{lang === "no" ? "Tilbake til oppskrift" : "Back to recipe"}</span>
      </button>

      {/* Summary */}
      <div className="meny-header">
        <div className="meny-header-left">
          <span className="meny-header-store">{storeName}</span>
          <span className={`meny-header-count${trueAllMatched ? "" : " partial"}`}>
            {matchedCount}/{totalCount} {lang === "no" ? "varer funnet" : "items found"}
          </span>
        </div>
        <div className="meny-header-total">
          <span className="meny-header-ca">ca.</span>
          <span className="meny-header-sum">{Math.round(totalPrice)}</span>
          <span className="meny-header-currency">kr</span>
        </div>
      </div>

      {/* Products to buy */}
      {toBuy.length > 0 && (
        <div className="meny-list">
          {toBuy.map((match, i) => (
            <ProductCard key={match.ingredient} match={match} lang={lang} index={i} />
          ))}
        </div>
      )}

      {/* Pantry staples */}
      {pantry.length > 0 && (
        <div className="meny-pantry">
          <span className="meny-pantry-label">
            {lang === "no" ? "Har trolig hjemme" : "Likely at home"}
          </span>
          <div className="meny-list meny-list-pantry">
            {pantry.map((match, i) => (
              <ProductCard key={match.ingredient} match={match} lang={lang} index={toBuy.length + i} />
            ))}
          </div>
        </div>
      )}

      {/* Unmatched */}
      {unmatched.length > 0 && (
        <div className="meny-missed">
          <span className="meny-missed-label">
            {lang === "no" ? "Ikke funnet" : "Not found"}
          </span>
          <div className="meny-missed-items">
            {unmatched.map(m => (
              <span key={m.ingredient} className="meny-missed-item">{m.ingredient}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
