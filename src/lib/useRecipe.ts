import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Recipe } from "@/lib/types";
import { generateRecipe } from "@/lib/api-client";

interface RecipeModalState {
  isOpen: boolean;
  dishName: string;
  canteenName: string;
  recipe: Recipe | null;
  isLoading: boolean;
  error: string | null;
}

const INITIAL_STATE: RecipeModalState = {
  isOpen: false,
  dishName: "",
  canteenName: "",
  recipe: null,
  isLoading: false,
  error: null,
};

interface UseRecipeReturn {
  recipeModal: RecipeModalState;
  recipeServings: number;
  setRecipeServings: (fn: (s: number) => number) => void;
  handleRecipeClick: (dishName: string, canteenName: string) => Promise<void>;
  closeRecipe: () => void;
}

export function useRecipe(lang: "no" | "en"): UseRecipeReturn {
  const queryClient = useQueryClient();
  const [recipeModal, setRecipeModal] =
    useState<RecipeModalState>(INITIAL_STATE);
  const [recipeServings, setRecipeServings] = useState(4);

  const recipeMutation = useMutation({
    mutationFn: async ({
      dishName,
      lang,
    }: {
      dishName: string;
      lang: "no" | "en";
    }) => {
      const cached = queryClient.getQueryData<Recipe>(["recipe", dishName, lang]);
      if (cached) return cached;

      const recipe = (await generateRecipe({ dishName, lang })) as Recipe;
      queryClient.setQueryData(["recipe", dishName, lang], recipe);
      return recipe;
    },
  });

  const handleRecipeClick = useCallback(
    async (dishName: string, canteenName: string) => {
      setRecipeModal({
        isOpen: true,
        dishName,
        canteenName,
        recipe: null,
        isLoading: true,
        error: null,
      });

      try {
        const recipe = await recipeMutation.mutateAsync({ dishName, lang });
        setRecipeServings(recipe.servings);
        setRecipeModal({
          isOpen: true,
          dishName,
          canteenName,
          recipe,
          isLoading: false,
          error: null,
        });
      } catch (err) {
        setRecipeModal((prev) => ({
          ...prev,
          isLoading: false,
          error:
            lang === "no"
              ? "Kunne ikke generere oppskrift"
              : "Could not generate recipe",
        }));
      }
    },
    [lang, recipeMutation]
  );

  const closeRecipe = useCallback(() => {
    setRecipeModal(INITIAL_STATE);
  }, []);

  return {
    recipeModal,
    recipeServings,
    setRecipeServings,
    handleRecipeClick,
    closeRecipe,
  };
}
