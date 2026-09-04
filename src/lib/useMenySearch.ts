import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Recipe, MenyResponse } from "@/lib/types";
import { searchMeny } from "@/lib/api-client";

interface MenyViewState {
  isOpen: boolean;
  data: MenyResponse | null;
  isLoading: boolean;
  error: string | null;
}

const INITIAL_STATE: MenyViewState = {
  isOpen: false,
  data: null,
  isLoading: false,
  error: null,
};

interface UseMenySearchReturn {
  menyView: MenyViewState;
  handleMenyClick: (dishName: string, recipe: Recipe) => Promise<void>;
  closeMeny: () => void;
}

export function useMenySearch(): UseMenySearchReturn {
  const queryClient = useQueryClient();
  const [menyView, setMenyView] = useState<MenyViewState>(INITIAL_STATE);

  const menyMutation = useMutation({
    mutationFn: async ({
      dishName,
      recipe,
    }: {
      dishName: string;
      recipe: Recipe;
    }) => {
      const cached = queryClient.getQueryData<MenyResponse>(["meny", dishName]);
      if (cached) return cached;

      const data = (await searchMeny({
        ingredients: recipe.ingredients,
        dishName,
        lang: "no",
      })) as MenyResponse;

      queryClient.setQueryData(["meny", dishName], data);
      return data;
    },
  });

  const handleMenyClick = useCallback(
    async (dishName: string, recipe: Recipe) => {
      setMenyView({ isOpen: true, data: null, isLoading: true, error: null });

      try {
        const data = await menyMutation.mutateAsync({ dishName, recipe });
        setMenyView({
          isOpen: true,
          data,
          isLoading: false,
          error: null,
        });
      } catch (err) {
        setMenyView((prev) => ({
          ...prev,
          isLoading: false,
          error:
            "Kunne ikke søke hos Meny",
        }));
      }
    },
    [menyMutation]
  );

  const closeMeny = useCallback(() => {
    setMenyView(INITIAL_STATE);
  }, []);

  return { menyView, handleMenyClick, closeMeny };
}
