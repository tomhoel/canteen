import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import type { DealsResponse, ProductOffer } from "@/lib/types";
import { DealsTable } from "@/components/DealsTable";
import { PriceRanger } from "@/components/PriceRanger";

interface DealsViewProps {
  deals: DealsResponse;
  lang: "no" | "en";
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

export default function DealsView({ deals, lang, onBack, isStreaming }: DealsViewProps) {
  const { recommendation, allStores, searchedIngredients } = deals;
  const [maxPrice, setMaxPrice] = useState(250);
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");

  // Collect all flat offers
  const flatOffers = useMemo(() => {
    const list: ProductOffer[] = [];
    allStores.forEach((s) => list.push(...s.deals));
    return list.filter((item) => item.price <= maxPrice);
  }, [allStores, maxPrice]);

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
          <span>{lang === "no" ? "Tilbake til oppskrift" : "Back to recipe"}</span>
        </button>
        <div style={{ display: "flex", gap: "6px" }}>
          <button
            onClick={() => setViewMode("cards")}
            style={{
              padding: "4px 10px",
              borderRadius: "6px",
              border: "1px solid #ece4d8",
              background: viewMode === "cards" ? "#c8741a" : "#ffffff",
              color: viewMode === "cards" ? "#ffffff" : "#6b6158",
              fontWeight: 600,
              fontSize: "0.8rem",
              cursor: "pointer",
            }}
          >
            Kort
          </button>
          <button
            onClick={() => setViewMode("table")}
            style={{
              padding: "4px 10px",
              borderRadius: "6px",
              border: "1px solid #ece4d8",
              background: viewMode === "table" ? "#c8741a" : "#ffffff",
              color: viewMode === "table" ? "#ffffff" : "#6b6158",
              fontWeight: 600,
              fontSize: "0.8rem",
              cursor: "pointer",
            }}
          >
            Tabell (TanStack Table)
          </button>
        </div>
      </div>

      <PriceRanger min={0} max={250} value={maxPrice} onChange={setMaxPrice} />

      {viewMode === "table" ? (
        <DealsTable deals={flatOffers} />
      ) : hasDeals || isStreaming ? (
        <>
          {showRecommendation && (
            <div className="deals-recommendation" style={{ borderColor: recommendation.storeColor + "30" }}>
              <div className="deals-rec-header">
                {recommendation.storeLogo && (
                  <img src={recommendation.storeLogo} alt={recommendation.store} className="deals-rec-logo" />
                )}
                <div>
                  <span className="deals-rec-badge">
                    {lang === "no" ? "Anbefalt butikk" : "Recommended Store"}
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
                    {lang === "no" ? "Totalpris" : "Total price"}
                  </span>
                </div>
                <div className="deals-rec-stat">
                  <span className="deals-rec-stat-value">
                    {recommendation.keyIngredientsCovered} / {searchedIngredients.length}
                  </span>
                  <span className="deals-rec-stat-label">
                    {lang === "no" ? "Dekket" : "Covered"}
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
          <p>{lang === "no" ? "Ingen tilbud funnet for disse ingrediensene." : "No deals found."}</p>
        </div>
      )}
    </div>
  );
}
