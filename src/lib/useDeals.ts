import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Recipe, DealsResponse } from "@/lib/types";
import { fetchDeals } from "@/lib/api-client";

interface DealsViewState {
  isOpen: boolean;
  deals: DealsResponse | null;
  isLoading: boolean;
  isStreaming: boolean;
  error: string | null;
}

const INITIAL_STATE: DealsViewState = {
  isOpen: false,
  deals: null,
  isLoading: false,
  isStreaming: false,
  error: null,
};

interface UseDealsReturn {
  dealsView: DealsViewState;
  handleDealsClick: (dishName: string, recipe: Recipe) => Promise<void>;
  closeDeals: () => void;
}

export function useDeals(): UseDealsReturn {
  const queryClient = useQueryClient();
  const [dealsView, setDealsView] = useState<DealsViewState>(INITIAL_STATE);

  const dealsMutation = useMutation({
    mutationFn: async ({
      dishName,
      recipe,
    }: {
      dishName: string;
      recipe: Recipe;
    }) => {
      const cached = queryClient.getQueryData<DealsResponse>(["deals", dishName]);
      if (cached) return cached;

      const deals = (await fetchDeals({
        ingredients: recipe.ingredients,
        dishName,
        // The API still takes a language — it decides what the model writes
        // back. The UI is Norwegian-only, so it is a constant, not a setting.
        lang: "no",
      })) as DealsResponse;

      queryClient.setQueryData(["deals", dishName], deals);
      return deals;
    },
  });

  const handleDealsClick = useCallback(
    async (dishName: string, recipe: Recipe) => {
      setDealsView({
        isOpen: true,
        deals: null,
        isLoading: true,
        isStreaming: false,
        error: null,
      });

      try {
        const deals = await dealsMutation.mutateAsync({ dishName, recipe });
        setDealsView({
          isOpen: true,
          deals,
          isLoading: false,
          isStreaming: false,
          error: null,
        });
      } catch (err) {
        setDealsView((prev) => ({
          ...prev,
          isLoading: false,
          isStreaming: false,
          error:
            "Kunne ikke finne priser",
        }));
      }
    },
    [dealsMutation]
  );

  const closeDeals = useCallback(() => {
    setDealsView(INITIAL_STATE);
  }, []);

  return { dealsView, handleDealsClick, closeDeals };
}
