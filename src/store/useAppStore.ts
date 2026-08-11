import { Store, useStore } from "@tanstack/react-store";

export interface AppState {
  maxPriceFilter: number;
  searchQuery: string;
  selectedStoreFilter: string;
  feedbackModalOpen: boolean;
}

export const appStore = new Store<AppState>({
  maxPriceFilter: 500,
  searchQuery: "",
  selectedStoreFilter: "ALL",
  feedbackModalOpen: false,
});

export function useAppStore<T>(selector: (state: AppState) => T): T {
  return useStore(appStore, selector);
}

export function setMaxPriceFilter(maxPrice: number) {
  appStore.setState((prev) => ({ ...prev, maxPriceFilter: maxPrice }));
}

export function setSearchQuery(query: string) {
  appStore.setState((prev) => ({ ...prev, searchQuery: query }));
}

export function setSelectedStoreFilter(store: string) {
  appStore.setState((prev) => ({ ...prev, selectedStoreFilter: store }));
}

export function setFeedbackModalOpen(open: boolean) {
  appStore.setState((prev) => ({ ...prev, feedbackModalOpen: open }));
}
