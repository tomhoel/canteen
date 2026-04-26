"use client";

import { useState, useCallback, useRef } from "react";
import type { Recipe } from "@/lib/types";

interface RecipeModalState {
  isOpen: boolean;
  dishName: string;
  canteenName: string;
  recipe: Recipe | null;
  isLoading: boolean;
  error: string | null;
}

const INITIAL_STATE: RecipeModalState = {
  isOpen: false, dishName: "", canteenName: "", recipe: null, isLoading: false, error: null,
};

interface UseRecipeReturn {
  recipeModal: RecipeModalState;
  recipeServings: number;
  setRecipeServings: (fn: (s: number) => number) => void;
  handleRecipeClick: (dishName: string, canteenName: string) => Promise<void>;
  closeRecipe: () => void;
}

export function useRecipe(lang: "no" | "en"): UseRecipeReturn {
  const [recipeModal, setRecipeModal] = useState<RecipeModalState>(INITIAL_STATE);
  const [recipeServings, setRecipeServings] = useState(4);
  const abortRef = useRef<AbortController | null>(null);

  const handleRecipeClick = useCallback(async (dishName: string, canteenName: string) => {
    // Abort any in-flight request
    abortRef.current?.abort();

    const cacheKey = `recipe_v4_${lang}_${dishName}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const recipe = JSON.parse(cached) as Recipe;
        setRecipeServings(recipe.servings);
        setRecipeModal({ isOpen: true, dishName, canteenName, recipe, isLoading: false, error: null });
        return;
      } catch { /* cache corrupted, refetch */ }
    }

    setRecipeModal({ isOpen: true, dishName, canteenName, recipe: null, isLoading: true, error: null });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dishName, lang }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('Failed');
      const recipe = await res.json() as Recipe;
      localStorage.setItem(cacheKey, JSON.stringify(recipe));
      setRecipeServings(recipe.servings);
      setRecipeModal(prev => ({ ...prev, recipe, isLoading: false }));
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setRecipeModal(prev => ({
        ...prev, isLoading: false,
        error: lang === 'no' ? 'Kunne ikke generere oppskrift' : 'Could not generate recipe',
      }));
    }
  }, [lang]);

  const closeRecipe = useCallback(() => {
    abortRef.current?.abort();
    setRecipeModal(INITIAL_STATE);
  }, []);

  return { recipeModal, recipeServings, setRecipeServings, handleRecipeClick, closeRecipe };
}
