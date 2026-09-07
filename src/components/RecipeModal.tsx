"use client";

import { lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { getMealDbUrl, getSpoonUrl, getLetterFallback } from "@/lib/ingredientImg";
import type { Recipe } from "@/lib/types";
import type { RecipeModalState } from "@/lib/useRecipe";
import type { DealsViewState } from "@/lib/useDeals";
import type { MenyViewState } from "@/lib/useMenySearch";

// Moved down from HomeClient with the markup: these two only ever render
// inside this modal, so they belong to this chunk's graph rather than the
// shell's.
const DealsView = lazy(() => import("@/components/DealsView"));
const MenyView = lazy(() => import("@/components/MenyView"));

/**
 * The AI recipe panel, and the Meny/Deals views that open over it.
 *
 * Lazy, and it is the biggest reason to be: this was ~200 lines of JSX in
 * HomeClient plus `@/lib/ingredientImg` — 6.6 KB of ingredient-image URL
 * builders imported nowhere else in the app — all of it in the chunk the first
 * paint waits on, for a panel reached by two taps.
 *
 * Portalled to document.body, because HomeClient marks `.app-wrapper` inert
 * while this is open and an overlay inside that subtree is made unreachable by
 * the attribute meant to protect the page behind it.
 *
 * Rendered only while open, so the panel never has to survive its own close:
 * `closeRecipe` wipes the recipe to its initial state in the same update that
 * flips `isOpen`, so anything that kept this mounted through an exit animation
 * would fade out an empty card.
 */
export interface RecipeModalProps {
  recipeModal: RecipeModalState;
  recipeServings: number;
  setRecipeServings: (fn: (s: number) => number) => void;
  menyView: MenyViewState;
  dealsView: DealsViewState;
  handleRecipeClick: (dishName: string, canteenName: string) => void;
  handleMenyClick: (dishName: string, recipe: Recipe) => Promise<void>;
  handleDealsClick: (dishName: string, recipe: Recipe) => Promise<void>;
  closeRecipe: () => void;
  closeMeny: () => void;
  closeDeals: () => void;
}

export default function RecipeModal({
  recipeModal,
  recipeServings,
  setRecipeServings,
  menyView,
  dealsView,
  handleRecipeClick,
  handleMenyClick,
  handleDealsClick,
  closeRecipe,
  closeMeny,
  closeDeals,
}: RecipeModalProps) {
  return createPortal(
    <div
      className="recipe-overlay"
      role="presentation"
      onClick={() => { closeRecipe(); closeDeals(); closeMeny(); }}
    >
      <div
        className="recipe-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recipe-dish-title"
        onClick={e => e.stopPropagation()}
      >
        <button className="recipe-close" onClick={() => { closeRecipe(); closeDeals(); closeMeny(); }} aria-label="Lukk">&#xD7;</button>

{menyView.isOpen ? (
        <>
          <div className="recipe-header">
            <span className="recipe-canteen">{recipeModal.canteenName}</span>
            <h2 className="recipe-dish-name">{recipeModal.dishName}</h2>
          </div>

          {menyView.isLoading && (
            <div className="recipe-loading">
              <span className="recipe-loading-emoji meny-loading-bag">{"\uD83D\uDECD\uFE0F"}</span>
              <span className="recipe-loading-text">{"S\u00F8ker hos Meny..."}</span>
            </div>
          )}

          {menyView.error && (
            <div className="recipe-error">
              <p>{menyView.error}</p>
              <button className="recipe-retry-btn" onClick={() => recipeModal.recipe && handleMenyClick(recipeModal.dishName, recipeModal.recipe)}>
                {"Pr\u00F8v igjen"}
              </button>
            </div>
          )}

          {menyView.data && (
            <Suspense fallback={null}>
              <MenyView
                meny={menyView.data}
                onBack={closeMeny}
              />
            </Suspense>
          )}
        </>
      ) : dealsView.isOpen ? (
        <>
          <div className="recipe-header">
            <span className="recipe-canteen">{recipeModal.canteenName}</span>
            <h2 className="recipe-dish-name">{recipeModal.dishName}</h2>
          </div>

          {dealsView.isLoading && !dealsView.deals && (
            <div className="recipe-loading">
              <span className="recipe-loading-emoji deals-loading-cart">{"\uD83D\uDED2"}</span>
              <span className="recipe-loading-text">{"Sammenligner priser..."}</span>
            </div>
          )}

          {dealsView.error && (
            <div className="recipe-error">
              <p>{dealsView.error}</p>
              <button className="recipe-retry-btn" onClick={() => recipeModal.recipe && handleDealsClick(recipeModal.dishName, recipeModal.recipe)}>
                {"Pr\u00F8v igjen"}
              </button>
            </div>
          )}

          {dealsView.deals && (
            <Suspense fallback={null}>
              <DealsView
                deals={dealsView.deals}
                isStreaming={dealsView.isStreaming}
                onBack={closeDeals}
              />
            </Suspense>
          )}
        </>
      ) : (
        <>
          <div className="recipe-header">
            <span className="recipe-canteen">{recipeModal.canteenName}</span>
            <h2 className="recipe-dish-name">{recipeModal.dishName}</h2>
          </div>

          {recipeModal.isLoading && (
            <div className="recipe-loading">
              <span className="recipe-loading-emoji">&#x1F373;</span>
              <span className="recipe-loading-text">{"Genererer oppskrift..."}</span>
            </div>
          )}

          {recipeModal.error && (
            <div className="recipe-error">
              <p>{recipeModal.error}</p>
              <button className="recipe-retry-btn" onClick={() => handleRecipeClick(recipeModal.dishName, recipeModal.canteenName)}>
                {"Pr\u00F8v igjen"}
              </button>
            </div>
          )}

          {recipeModal.recipe && (() => {
            const scale = recipeServings / recipeModal.recipe.servings;
            const scaleAmount = (amount: string) => {
              const num = parseFloat(amount);
              if (isNaN(num)) return amount;
              const scaled = num * scale;
              return scaled % 1 === 0 ? scaled.toString() : scaled.toFixed(1).replace(/\.0$/, "");
            };
            const recipe = recipeModal.recipe;
            return (
            <>
              <div className="recipe-meta">
                <span className="recipe-meta-servings">
                  <button className="recipe-servings-btn" onClick={() => setRecipeServings(s => Math.max(1, s - 1))}>&#x2212;</button>
                  <span className="recipe-servings-value">{recipeServings}</span>
                  <button className="recipe-servings-btn" onClick={() => setRecipeServings(s => Math.min(20, s + 1))}>+</button>
                  <span className="recipe-servings-label">{"pers."}</span>
                </span>
                <span>{"Prep"}: {recipe.prepTime}</span>
                <span>{"Tilbereding"}: {recipe.cookTime}</span>
              </div>
              <div className="recipe-content">
                <div className="recipe-ingredients">
                  <h3 className="recipe-section-title">{"Ingredienser"}{scale !== 1 ? ` (${"\u00D7"}${scale % 1 === 0 ? scale : scale.toFixed(1)})` : ""}</h3>
                  <ul className="recipe-ingredient-list">
                    {recipe.ingredients.map((ing, i) => {
                      const fb = getLetterFallback(ing.item);
                      return (
                      <li key={i} className="recipe-ingredient-item" style={{ animationDelay: `${i * 50}ms` }}>
                        <div className="recipe-ingredient-img-wrap">
                          <img
                            src={getMealDbUrl(ing.item)}
                            alt=""
                            className="recipe-ingredient-img"
                            loading="lazy"
                            onLoad={e => { (e.target as HTMLImageElement).parentElement!.classList.add("has-img"); }}
                            onError={e => {
                              const img = e.target as HTMLImageElement;
                              if (!img.dataset.fallback) {
                                img.dataset.fallback = "1";
                                img.src = getSpoonUrl(ing.item);
                              } else {
                                img.style.display = "none";
                              }
                            }}
                          />
                          <span className="recipe-ingredient-letter" style={{ background: fb.color }}>{fb.letter}</span>
                        </div>
                        <div className="recipe-ingredient-details">
                          <span className="recipe-ingredient-name">{ing.itemLocal || ing.item}</span>
                          <span className="recipe-ingredient-amount">{scaleAmount(ing.amount)} {ing.unit}</span>
                        </div>
                      </li>
                      );
                    })}
                  </ul>
                  {/* Shopping divider + options */}
                  <div className="recipe-shop-divider" style={{ animationDelay: `${recipe.ingredients.length * 50 + 30}ms` }}>
                    <span className="shop-divider-label">{"Handle"}</span>
                  </div>
                  <div className="recipe-shop-row" style={{ animationDelay: `${recipe.ingredients.length * 50 + 50}ms` }}>
                    <button className="shop-card shop-card-meny" onClick={() => handleMenyClick(recipeModal.dishName, recipe)}>
                      <span className="shop-card-icon shop-icon-meny">
                        <span className="shop-icon-check" />
                      </span>
                      <span className="shop-card-text">
                        <span className="shop-card-label">{"Handleliste"}</span>
                        <span className="shop-card-sub">Meny</span>
                      </span>
                    </button>
                    <button className="shop-card shop-card-deals" onClick={() => handleDealsClick(recipeModal.dishName, recipe)}>
                      <span className="shop-card-icon shop-icon-deals">
                        <span className="shop-icon-tag" />
                      </span>
                      <span className="shop-card-text">
                        <span className="shop-card-label">{"Ukens tilbud"}</span>
                        <span className="shop-card-sub">{"Alle butikker"}</span>
                      </span>
                    </button>
                  </div>
                </div>
                <div className="recipe-steps">
                  <h3 className="recipe-section-title">{"Fremgangsm\u00E5te"}</h3>
                  <ol className="recipe-step-list">
                    {recipe.steps.map((step, i) => (
                      <li key={i} className="recipe-step-item" style={{ animationDelay: `${(i * 50) + 150}ms` }}>
                        <span className="recipe-step-number">{i + 1}</span>
                        <span className="recipe-step-text">{step}</span>
                      </li>
                    ))}
                  </ol>
                  {recipe.tip && (
                    <div className="recipe-tip">
                      <span className="recipe-tip-icon">&#x1F4A1;</span>
                      <span className="recipe-tip-text">{recipe.tip}</span>
                    </div>
                  )}
                </div>
              </div>
            </>
            );
          })()}
        </>
      )}
      </div>
    </div>,
    document.body
  );
}
