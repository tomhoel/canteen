import type { DealsResponse, TjekOffer } from "@/lib/types";

interface DealsViewProps {
  deals: DealsResponse;
  lang: "no" | "en";
  onBack: () => void;
}

export default function DealsView({ deals, lang, onBack }: DealsViewProps) {
  const { recommendation, allStores, searchedIngredients } = deals;

  // Group all deals across stores by ingredient
  const dealsByIngredient = new Map<string, TjekOffer[]>();
  for (const store of allStores) {
    for (const deal of store.deals) {
      const existing = dealsByIngredient.get(deal.matchedIngredient) || [];
      existing.push(deal);
      dealsByIngredient.set(deal.matchedIngredient, existing);
    }
  }

  // Find ingredients with no deals
  const ingredientsWithDeals = new Set(dealsByIngredient.keys());
  const noDealsIngredients = searchedIngredients.filter(i => !ingredientsWithDeals.has(i));

  const hasDeals = recommendation.dealCount > 0;

  return (
    <div className="deals-view">
      <button className="deals-back" onClick={onBack}>
        <span className="deals-back-arrow">{"\u2039"}</span>
        <span>{lang === "no" ? "Tilbake til oppskrift" : "Back to recipe"}</span>
      </button>

      {hasDeals ? (
        <>
          {/* Recommendation Card */}
          <div className="deals-recommendation" style={{ borderColor: recommendation.storeColor + '30' }}>
            <div className="deals-rec-header">
              {recommendation.storeLogo && (
                <img src={recommendation.storeLogo} alt={recommendation.store} className="deals-rec-logo" />
              )}
              <div className="deals-rec-info">
                <span className="deals-rec-label">{lang === "no" ? "Anbefalt butikk" : "Recommended store"}</span>
                <span className="deals-rec-store" style={{ color: recommendation.storeColor }}>{recommendation.store}</span>
              </div>
            </div>
            <div className="deals-rec-stats">
              <div className="deals-rec-stat">
                <span className="deals-rec-stat-value">{recommendation.dealCount}</span>
                <span className="deals-rec-stat-label">{lang === "no" ? "tilbud" : "deals"}</span>
              </div>
              <div className="deals-rec-stat">
                <span className="deals-rec-stat-value">{recommendation.keyIngredientsCovered}</span>
                <span className="deals-rec-stat-label">{lang === "no" ? "nøkkelingredienser" : "key ingredients"}</span>
              </div>
              <div className="deals-rec-stat">
                <span className="deals-rec-stat-value">~{Math.round(recommendation.totalPrice)} kr</span>
                <span className="deals-rec-stat-label">{lang === "no" ? "totalt" : "total"}</span>
              </div>
            </div>
          </div>

          {/* Other stores summary */}
          {allStores.length > 1 && (
            <div className="deals-other-stores">
              <span className="deals-other-label">{lang === "no" ? "Andre butikker med tilbud" : "Other stores with deals"}</span>
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

          {/* Deals grouped by ingredient */}
          {Array.from(dealsByIngredient.entries()).map(([ingredient, ingredientDeals]) => (
            <div key={ingredient} className="deals-ingredient-group">
              <h4 className="deals-ingredient-title">{ingredient}</h4>
              <div className="deals-cards">
                {ingredientDeals.map(deal => {
                  const cardClass = `deals-card${deal.store === recommendation.store ? " deals-card-recommended" : ""}${deal.flyerUrl ? " deals-card-link" : ""}`;
                  const cardStyle = deal.store === recommendation.store ? { borderColor: recommendation.storeColor + '40' } : undefined;
                  const content = (
                    <>
                      {deal.imageUrl && (
                        <div className="deals-card-img-wrap">
                          <img src={deal.imageUrl} alt={deal.heading} className="deals-card-img" loading="lazy" />
                        </div>
                      )}
                      <div className="deals-card-content">
                        <div className="deals-card-store-row">
                          {deal.storeLogo && <img src={deal.storeLogo} alt="" className="deals-card-store-logo" />}
                          <span className="deals-card-store" style={{ color: deal.storeColor }}>{deal.store}</span>
                          {deal.store === recommendation.store && (
                            <span className="deals-card-rec-badge">{"\u2605"}</span>
                          )}
                        </div>
                        <span className="deals-card-heading">{deal.heading}</span>
                        <div className="deals-card-price-row">
                          <span className="deals-card-price">{deal.price} kr</span>
                          {deal.prePrice && deal.prePrice > deal.price && (
                            <span className="deals-card-savings">
                              -{Math.round(((deal.prePrice - deal.price) / deal.prePrice) * 100)}%
                            </span>
                          )}
                        </div>
                        {deal.prePrice && deal.prePrice > deal.price && (
                          <span className="deals-card-pre-price">{deal.prePrice} kr</span>
                        )}
                        {deal.flyerUrl && (
                          <span className="deals-card-flyer-link">
                            {lang === "no" ? "Se i kundeavis" : "View in flyer"} {"\u203A"}
                          </span>
                        )}
                      </div>
                    </>
                  );
                  return deal.flyerUrl ? (
                    <a key={deal.id} href={deal.flyerUrl} target="_blank" rel="noopener noreferrer" className={cardClass} style={cardStyle}>
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

          {/* No deals section */}
          {noDealsIngredients.length > 0 && (
            <div className="deals-no-results">
              <span className="deals-no-results-label">{lang === "no" ? "Ingen tilbud funnet for" : "No deals found for"}</span>
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
            {lang === "no" ? "Ingen tilbud funnet akkurat nå" : "No deals found right now"}
          </span>
          <span className="deals-empty-sub">
            {lang === "no" ? "Prøv igjen senere — nye tilbud kommer hver uke" : "Try again later — new deals come every week"}
          </span>
        </div>
      )}
    </div>
  );
}
