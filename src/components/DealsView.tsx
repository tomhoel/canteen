import { useRef, useState, useCallback, useEffect } from "react";
import type { DealsResponse, ProductOffer } from "@/lib/types";
import { PriceRanger } from "@/components/PriceRanger";
import "@/styles/deals-view.css";

interface DealsViewProps {
  deals: DealsResponse;
  onBack: () => void;
  isStreaming?: boolean;
}

function DealsCarousel({ children }: { children: React.ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener("scroll", checkScroll, { passive: true });
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", checkScroll); ro.disconnect(); };
  }, [checkScroll, children]);

  const scroll = useCallback((dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 168 * 4, behavior: "smooth" });
  }, []);

  return (
    <div className="deals-carousel">
      {canScrollLeft && (
        <button className="deals-carousel-arrow deals-carousel-arrow-left" onClick={() => scroll(-1)} aria-label="Previous">
          {"\u2039"}
        </button>
      )}
      <div className="deals-cards" ref={scrollRef}>
        {children}
      </div>
      {canScrollRight && (
        <button className="deals-carousel-arrow deals-carousel-arrow-right" onClick={() => scroll(1)} aria-label="Next">
          {"\u203A"}
        </button>
      )}
    </div>
  );
}

export default function DealsView({ deals, onBack, isStreaming }: DealsViewProps) {
  const { recommendation, allStores, searchedIngredients } = deals;
  const [maxPrice, setMaxPrice] = useState(250);


  const dealsByIngredient = new Map<string, ProductOffer[]>();
  for (const store of allStores) {
    for (const deal of store.deals) {
      if (deal.price <= maxPrice) {
        const existing = dealsByIngredient.get(deal.matchedIngredient) || [];
        existing.push(deal);
        dealsByIngredient.set(deal.matchedIngredient, existing);
      }
    }
  }

  for (const [, products] of dealsByIngredient) {
    products.sort((a, b) => {
      if (a.price !== b.price) return a.price - b.price;
      return (b.isCampaign ? 1 : 0) - (a.isCampaign ? 1 : 0);
    });
  }

  const hasDeals = dealsByIngredient.size > 0;
  const showRecommendation = !isStreaming && recommendation.store !== "";

  return (
    <div className="deals-view">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <button className="deals-back" onClick={onBack}>
          <span className="deals-back-arrow">{"\u2039"}</span>
          <span>{"Tilbake til oppskrift"}</span>
        </button>
      </div>

      <PriceRanger min={0} max={250} value={maxPrice} onChange={setMaxPrice} />

      {hasDeals || isStreaming ? (
        <>
          {showRecommendation && (
            <div className="deals-recommendation" style={{ borderColor: recommendation.storeColor + "30" }}>
              <div className="deals-rec-header">
                {recommendation.storeLogo && (
                  <img src={recommendation.storeLogo} alt={recommendation.store} className="deals-rec-logo" />
                )}
                <div>
                  <span className="deals-rec-badge">
                    {"Anbefalt butikk"}
                  </span>
                  <h3 className="deals-rec-store" style={{ color: recommendation.storeColor }}>
                    {recommendation.store}
                  </h3>
                </div>
              </div>
              <div className="deals-rec-stats">
                <div className="deals-rec-stat">
                  <span className="deals-rec-stat-value">{recommendation.totalPrice.toFixed(2)} kr</span>
                  <span className="deals-rec-stat-label">
                    {"Totalpris"}
                  </span>
                </div>
                <div className="deals-rec-stat">
                  <span className="deals-rec-stat-value">
                    {recommendation.keyIngredientsCovered} / {searchedIngredients.length}
                  </span>
                  <span className="deals-rec-stat-label">
                    {"Dekket"}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="deals-ingredients">
            {Array.from(dealsByIngredient.entries()).map(([ingredient, products]) => (
              <div key={ingredient} className="deals-ingredient-group">
                <h4 className="deals-ingredient-name">
                  {ingredient}
                  <span className="deals-ingredient-count"> ({products.length})</span>
                </h4>
                <DealsCarousel>
                  {products.map((deal) => (
                    <div key={deal.id} className="deals-card">
                      <div className="deals-card-top">
                        <div className="deals-store-badge" style={{ backgroundColor: deal.storeColor }}>
                          {deal.storeLogo ? (
                            <img src={deal.storeLogo} alt={deal.store} className="deals-store-logo-icon" />
                          ) : null}
                          <span>{deal.store}</span>
                        </div>
                        {deal.savingsPercent != null && (
                          <span className="deals-savings-badge">-{deal.savingsPercent}%</span>
                        )}
                      </div>
                      <div className="deals-card-image-wrap">
                        {deal.imageUrl ? (
                          <img src={deal.imageUrl} alt={deal.name} className="deals-card-image" loading="lazy" />
                        ) : (
                          <div className="deals-card-no-image">📦</div>
                        )}
                      </div>
                      <div className="deals-card-body">
                        <span className="deals-card-title">{deal.name}</span>
                        <div className="deals-card-price-row">
                          <span className="deals-card-price">{deal.price.toFixed(2).replace(".", ",")} kr</span>
                          {deal.originalPrice != null && (
                            <span className="deals-card-orig-price">{deal.originalPrice.toFixed(2)} kr</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </DealsCarousel>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="deals-empty">
          <p>{"Ingen tilbud funnet for disse ingrediensene."}</p>
        </div>
      )}
    </div>
  );
}
