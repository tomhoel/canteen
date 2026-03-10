import type { DealsResponse, ProductOffer } from "@/lib/types";

interface DealsViewProps {
  deals: DealsResponse;
  lang: "no" | "en";
  onBack: () => void;
  isStreaming?: boolean;
}

export default function DealsView({ deals, lang, onBack, isStreaming }: DealsViewProps) {
  const { recommendation, allStores, searchedIngredients } = deals;

  // Group all products across stores by ingredient
  const dealsByIngredient = new Map<string, ProductOffer[]>();
  for (const store of allStores) {
    for (const deal of store.deals) {
      const existing = dealsByIngredient.get(deal.matchedIngredient) || [];
      existing.push(deal);
      dealsByIngredient.set(deal.matchedIngredient, existing);
    }
  }

  // Sort each ingredient's products by price (campaigns first at equal price)
  for (const [, products] of dealsByIngredient) {
    products.sort((a, b) => {
      if (a.price !== b.price) return a.price - b.price;
      return (b.isCampaign ? 1 : 0) - (a.isCampaign ? 1 : 0);
    });
  }

  // Find ingredients with no results
  const ingredientsWithDeals = new Set(dealsByIngredient.keys());
  const noDealsIngredients = searchedIngredients.filter(i => !ingredientsWithDeals.has(i));

  const hasDeals = dealsByIngredient.size > 0;
  const showRecommendation = !isStreaming && recommendation.store !== '';

  return (
    <div className="deals-view">
      <button className="deals-back" onClick={onBack}>
        <span className="deals-back-arrow">{"\u2039"}</span>
        <span>{lang === "no" ? "Tilbake til oppskrift" : "Back to recipe"}</span>
      </button>

      {hasDeals || isStreaming ? (
        <>
          {/* Recommendation Card — only after streaming completes */}
          {showRecommendation && (
            <div className="deals-recommendation" style={{ borderColor: recommendation.storeColor + '30' }}>
              <div className="deals-rec-header">
                {recommendation.storeLogo && (
                  <img src={recommendation.storeLogo} alt={recommendation.store} className="deals-rec-logo" />
                )}
                <div className="deals-rec-info">
                  <span className="deals-rec-label">{lang === "no" ? "Billigste butikk" : "Cheapest store"}</span>
                  <span className="deals-rec-store" style={{ color: recommendation.storeColor }}>{recommendation.store}</span>
                </div>
              </div>
              <div className="deals-rec-stats">
                <div className="deals-rec-stat">
                  <span className="deals-rec-stat-value">{recommendation.dealCount}</span>
                  <span className="deals-rec-stat-label">{lang === "no" ? "produkter" : "products"}</span>
                </div>
                <div className="deals-rec-stat">
                  <span className="deals-rec-stat-value">{recommendation.keyIngredientsCovered}</span>
                  <span className="deals-rec-stat-label">{lang === "no" ? "ingredienser" : "ingredients"}</span>
                </div>
                <div className="deals-rec-stat">
                  <span className="deals-rec-stat-value">~{Math.round(recommendation.totalPrice)} kr</span>
                  <span className="deals-rec-stat-label">{lang === "no" ? "totalt" : "total"}</span>
                </div>
              </div>
            </div>
          )}

          {/* Other stores summary — only after streaming */}
          {showRecommendation && allStores.length > 1 && (
            <div className="deals-other-stores">
              <span className="deals-other-label">{lang === "no" ? "Priser i andre butikker" : "Prices at other stores"}</span>
              <div className="deals-other-list">
                {allStores.slice(1).map(store => (
                  <div key={store.store} className="deals-other-chip">
                    {store.storeLogo && <img src={store.storeLogo} alt="" className="deals-other-chip-logo" />}
                    <span>{store.store}</span>
                    <span className="deals-other-chip-count">{store.dealCount}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Products grouped by ingredient */}
          {Array.from(dealsByIngredient.entries()).map(([ingredient, ingredientDeals]) => (
            <div key={ingredient} className="deals-ingredient-group">
              <h4 className="deals-ingredient-title">{ingredient}</h4>
              <div className="deals-cards">
                {ingredientDeals.map(deal => {
                  const isRec = !isStreaming && deal.store === recommendation.store;
                  const cardClass = `deals-card${isRec ? " deals-card-recommended" : ""}${deal.isCampaign ? " deals-card-campaign" : ""}${deal.productUrl ? " deals-card-link" : ""}`;
                  const cardStyle = isRec ? { borderColor: recommendation.storeColor + '40' } : undefined;
                  const content = (
                    <>
                      {deal.imageUrl && (
                        <div className="deals-card-img-wrap">
                          <img src={deal.imageUrl} alt={deal.name} className="deals-card-img" loading="lazy" />
                        </div>
                      )}
                      <div className="deals-card-content">
                        <div className="deals-card-store-row">
                          {deal.storeLogo && <img src={deal.storeLogo} alt="" className="deals-card-store-logo" />}
                          <span className="deals-card-store" style={{ color: deal.storeColor }}>{deal.store}</span>
                          {isRec && (
                            <span className="deals-card-rec-badge">{"\u2605"}</span>
                          )}
                          {deal.isCampaign && <span className="deals-card-campaign-badge">{lang === "no" ? "Tilbud" : "Sale"}</span>}
                        </div>
                        <span className="deals-card-heading">{deal.name}</span>
                        {(deal.weight || deal.unitPrice != null) && (
                          <span className="deals-card-qty">
                            {deal.weight || ""}
                            {deal.weight && deal.unitPrice != null ? " \u00B7 " : ""}
                            {deal.unitPrice != null ? `${deal.unitPrice.toFixed(2).replace('.', ',')} kr/kg` : ""}
                          </span>
                        )}
                        <div className="deals-card-price-row">
                          <span className={deal.isCampaign ? "deals-card-price deals-card-price-campaign" : "deals-card-price"}>{deal.price} kr</span>
                          {deal.originalPrice != null && <span className="deals-card-original-price">{deal.originalPrice} kr</span>}
                          {deal.savingsPercent != null && <span className="deals-card-savings">-{deal.savingsPercent}%</span>}
                        </div>
                        {deal.brand && (
                          <span className="deals-card-brand">{deal.brand}</span>
                        )}
                        <span className="deals-card-source">
                          via {deal.source === 'tjek' ? 'eTilbudsavis' : 'Kassal'}
                          {deal.validUntil && <> · {lang === "no" ? "til" : "until"} {new Date(deal.validUntil).toLocaleDateString(lang === "no" ? "nb-NO" : "en-GB", { day: "numeric", month: "short" })}</>}
                        </span>
                        {deal.productUrl && (
                          <span className="deals-card-flyer-link">
                            {deal.isCampaign
                              ? (lang === "no" ? "Se i tilbudsavis" : "View flyer")
                              : (lang === "no" ? "Se i nettbutikk" : "View in store")
                            } {"\u203A"}
                          </span>
                        )}
                      </div>
                    </>
                  );
                  return deal.productUrl ? (
                    <a key={deal.id} href={deal.productUrl} target="_blank" rel="noopener noreferrer" className={cardClass} style={cardStyle}>
                      {content}
                    </a>
                  ) : (
                    <div key={deal.id} className={cardClass} style={cardStyle}>
                      {content}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Streaming indicator */}
          {isStreaming && (
            <div className="deals-streaming">
              <span className="deals-loading-cart deals-streaming-icon">{"\uD83D\uDED2"}</span>
              <span className="deals-streaming-text">{lang === "no" ? "Søker flere ingredienser..." : "Searching more ingredients..."}</span>
            </div>
          )}

          {/* No results section — only after streaming */}
          {!isStreaming && noDealsIngredients.length > 0 && (
            <div className="deals-no-results">
              <span className="deals-no-results-label">{lang === "no" ? "Ingen priser funnet for" : "No prices found for"}</span>
              <div className="deals-no-results-list">
                {noDealsIngredients.map(ing => (
                  <span key={ing} className="deals-no-results-item">{ing}</span>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="deals-empty">
          <span className="deals-empty-icon">{"\uD83D\uDED2"}</span>
          <span className="deals-empty-text">
            {lang === "no" ? "Ingen produkter funnet" : "No products found"}
          </span>
          <span className="deals-empty-sub">
            {lang === "no" ? "Prøv igjen senere" : "Try again later"}
          </span>
        </div>
      )}
    </div>
  );
}
