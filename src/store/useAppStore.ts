import { Store, useStore } from "@tanstack/react-store";

export interface AppState {
  feedbackModalOpen: boolean;
}

export const appStore = new Store<AppState>({
  feedbackModalOpen: false,
});

export function useAppStore<T>(selector: (state: AppState) => T): T {
  return useStore(appStore, selector);
}

export function setFeedbackModalOpen(open: boolean) {
  appStore.setState((prev) => ({ ...prev, feedbackModalOpen: open }));
}
