import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Recipe, MenyResponse } from "@/lib/types";
import { searchMeny } from "@/server/meny";

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

export function useMenySearch(lang: "no" | "en"): UseMenySearchReturn {
  const queryClient = useQueryClient();
  const [menyView, setMenyView] = useState<MenyViewState>(INITIAL_STATE);

  const menyMutation = useMutation({
    mutationFn: async ({
      dishName,
      recipe,
      lang,
    }: {
      dishName: string;
      recipe: Recipe;
      lang: "no" | "en";
    }) => {
      const cached = queryClient.getQueryData<MenyResponse>(["meny", dishName, lang]);
      if (cached) return cached;

      const data = (await searchMeny({
        ingredients: recipe.ingredients,
        dishName,
        lang,
      })) as MenyResponse;

      queryClient.setQueryData(["meny", dishName, lang], data);
      return data;
    },
  });

  const handleMenyClick = useCallback(
    async (dishName: string, recipe: Recipe) => {
      setMenyView({ isOpen: true, data: null, isLoading: true, error: null });

      try {
        const data = await menyMutation.mutateAsync({ dishName, recipe, lang });
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
            lang === "no" ? "Kunne ikke søke hos Meny" : "Could not search Meny",
        }));
      }
    },
    [lang, menyMutation]
  );

  const closeMeny = useCallback(() => {
    setMenyView(INITIAL_STATE);
  }, []);

  return { menyView, handleMenyClick, closeMeny };
}
