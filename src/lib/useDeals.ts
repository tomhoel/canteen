"use client";

import { useState, useCallback, useRef } from "react";
import type { Recipe, DealsResponse, ProductOffer } from "@/lib/types";

interface DealsViewState {
  isOpen: boolean;
  deals: DealsResponse | null;
  isLoading: boolean;
  isStreaming: boolean;
  error: string | null;
}

const INITIAL_STATE: DealsViewState = {
  isOpen: false, deals: null, isLoading: false, isStreaming: false, error: null,
};

interface UseDealsReturn {
  dealsView: DealsViewState;
  handleDealsClick: (dishName: string, recipe: Recipe) => Promise<void>;
  closeDeals: () => void;
}

export function useDeals(lang: "no" | "en"): UseDealsReturn {
  const [dealsView, setDealsView] = useState<DealsViewState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  const handleDealsClick = useCallback(async (dishName: string, recipe: Recipe) => {
    // Abort any in-flight request
    abortRef.current?.abort();

    const cacheKey = `deals_v4_${dishName}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as DealsResponse;
        const age = Date.now() - new Date(parsed.generatedAt).getTime();
        if (age < 24 * 60 * 60 * 1000) {
          setDealsView({ isOpen: true, deals: parsed, isLoading: false, isStreaming: false, error: null });
          return;
        }
      } catch { /* stale/corrupt cache */ }
    }

    setDealsView({ isOpen: true, deals: null, isLoading: true, isStreaming: true, error: null });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredients: recipe.ingredients, dishName, lang }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('Failed');

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const deals = await res.json() as DealsResponse;
        localStorage.setItem(cacheKey, JSON.stringify(deals));
        setDealsView(prev => ({ ...prev, deals, isLoading: false, isStreaming: false }));
      } else {
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const accumulated: ProductOffer[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith('data: ')) continue;
            const data = JSON.parse(line.slice(6));

            if (data.type === 'ingredient') {
              accumulated.push(...(data.deals as ProductOffer[]));
              const partial: DealsResponse = {
                recommendation: { store: '', storeColor: '', storeLogo: '', totalPrice: 0, dealCount: 0, keyIngredientsCovered: 0, deals: [] },
                allStores: [{ store: '_stream', storeColor: '', storeLogo: '', totalPrice: 0, dealCount: accumulated.length, keyIngredientsCovered: 0, deals: [...accumulated] }],
                searchedIngredients: [data.name],
                generatedAt: '',
              };
              setDealsView(prev => {
                const prevSearched = prev.deals?.searchedIngredients || [];
                partial.searchedIngredients = [...prevSearched, data.name];
                return { ...prev, deals: partial };
              });
            } else if (data.type === 'done') {
              const { type: _type, ...response } = data; void _type;
              const deals = response as DealsResponse;
              localStorage.setItem(cacheKey, JSON.stringify(deals));
              setDealsView(prev => ({ ...prev, deals, isLoading: false, isStreaming: false }));
            } else if (data.type === 'error') {
              setDealsView(prev => ({
                ...prev, isLoading: false, isStreaming: false,
                error: lang === 'no' ? 'Kunne ikke finne priser' : 'Could not find prices',
              }));
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setDealsView(prev => ({
        ...prev, isLoading: false, isStreaming: false,
        error: lang === 'no' ? 'Kunne ikke finne priser' : 'Could not find prices',
      }));
    }
  }, [lang]);

  const closeDeals = useCallback(() => {
    abortRef.current?.abort();
    setDealsView(INITIAL_STATE);
  }, []);

  return { dealsView, handleDealsClick, closeDeals };
}
