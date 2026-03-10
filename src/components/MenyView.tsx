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
      className={`meny-product-card${match.outOfStock ? " out-of-stock" : ""}${match.product?.productUrl ? " linkable" : ""}`}
      style={{ animationDelay: `${index * 50}ms` }}
    >
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
        <span className="meny-product-ingredient">
          {match.ingredient}
          {recipeDesc && <span className="meny-recipe-amount"> · {recipeDesc}</span>}
        </span>
        <span className="meny-product-name">
          {match.product!.name}
          {match.product!.brand ? ` · ${match.product!.brand}` : ""}
          {match.product!.weight ? ` · ${match.product!.weight}` : ""}
        </span>
        {match.outOfStock && (
          <span className="meny-out-of-stock-badge">
            {lang === "no" ? "Utilgjengelig" : "Out of stock"}
          </span>
        )}
      </div>
      <div className="meny-product-right">
        <span className="meny-product-price">
          {match.outOfStock ? "–" : `${match.product!.price} kr`}
        </span>
        {match.product?.productUrl && <span className="meny-link-arrow">↗</span>}
      </div>
    </div>
  );

  return (
    <div className="meny-product-row">
      {match.product?.productUrl ? (
        <a href={match.product.productUrl} target="_blank" rel="noopener noreferrer" className="meny-product-link">
          {card}
        </a>
      ) : (
        card
      )}

      {hasAlts && (
        <button
          className={`meny-alts-toggle${showAlts ? " open" : ""}`}
          onClick={() => setShowAlts(!showAlts)}
        >
          <span className="meny-alts-chevron">{showAlts ? "▾" : "▸"}</span>
          {showAlts
            ? (lang === "no" ? "Skjul alternativer" : "Hide alternatives")
            : (lang === "no" ? `${match.alternatives.length} andre` : `${match.alternatives.length} others`)}
        </button>
      )}

      {hasAlts && showAlts && (
        <div className="meny-alts-list">
          {match.alternatives.map(alt => (
            <AltProduct key={alt.ean} product={alt} />
          ))}
        </div>
      )}
    </div>
  );
}

function AltProduct({ product }: { product: MenyProduct }) {
  const inner = (
    <div className="meny-alt-card">
      <div className="meny-alt-img-wrap">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="meny-alt-img" loading="lazy"
            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <span className="meny-product-img-placeholder">{product.name.charAt(0)}</span>
        )}
      </div>
      <span className="meny-alt-name">
        {product.name}
        {product.brand ? ` · ${product.brand}` : ""}
        {product.weight ? ` · ${product.weight}` : ""}
      </span>
      <div className="meny-product-right">
        <span className="meny-alt-price">{product.price} kr</span>
        {product.productUrl && <span className="meny-link-arrow small">↗</span>}
      </div>
    </div>
  );

  return product.productUrl ? (
    <a href={product.productUrl} target="_blank" rel="noopener noreferrer" className="meny-product-link">
      {inner}
    </a>
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

      {/* Products to buy */}
      {toBuy.length > 0 && (
        <div className="meny-product-list">
          {toBuy.map((match, i) => (
            <ProductCard key={match.ingredient} match={match} lang={lang} index={i} />
          ))}
        </div>
      )}

      {/* Pantry staples */}
      {pantry.length > 0 && (
        <>
          <div className="meny-pantry-header">
            <span className="meny-pantry-label">
              {lang === "no" ? "Har sannsynligvis hjemme" : "Likely have at home"}
            </span>
          </div>
          <div className="meny-product-list meny-pantry-list">
            {pantry.map((match, i) => (
              <ProductCard key={match.ingredient} match={match} lang={lang} index={toBuy.length + i} />
            ))}
          </div>
        </>
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
