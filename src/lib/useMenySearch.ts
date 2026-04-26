"use client";

import { useState, useCallback, useRef } from "react";
import type { Recipe, MenyResponse } from "@/lib/types";

interface MenyViewState {
  isOpen: boolean;
  data: MenyResponse | null;
  isLoading: boolean;
  error: string | null;
}

const INITIAL_STATE: MenyViewState = {
  isOpen: false, data: null, isLoading: false, error: null,
};

interface UseMenySearchReturn {
  menyView: MenyViewState;
  handleMenyClick: (dishName: string, recipe: Recipe) => Promise<void>;
  closeMeny: () => void;
}

export function useMenySearch(lang: "no" | "en"): UseMenySearchReturn {
  const [menyView, setMenyView] = useState<MenyViewState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  const handleMenyClick = useCallback(async (dishName: string, recipe: Recipe) => {
    // Abort any in-flight request
    abortRef.current?.abort();

    const cacheKey = `meny_v4_${dishName}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as MenyResponse;
        const age = Date.now() - new Date(parsed.generatedAt).getTime();
        if (age < 24 * 60 * 60 * 1000) {
          setMenyView({ isOpen: true, data: parsed, isLoading: false, error: null });
          return;
        }
      } catch { /* stale/corrupt cache */ }
    }

    setMenyView({ isOpen: true, data: null, isLoading: true, error: null });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/meny/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredients: recipe.ingredients, dishName, lang }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json() as MenyResponse;
      localStorage.setItem(cacheKey, JSON.stringify(data));
      setMenyView(prev => ({ ...prev, data, isLoading: false }));
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setMenyView(prev => ({
        ...prev, isLoading: false,
        error: lang === 'no' ? 'Kunne ikke s\u00F8ke hos Meny' : 'Could not search Meny',
      }));
    }
  }, [lang]);

  const closeMeny = useCallback(() => {
    abortRef.current?.abort();
    setMenyView(INITIAL_STATE);
  }, []);

  return { menyView, handleMenyClick, closeMeny };
}
