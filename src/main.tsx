import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "@/styles/globals.css";

/**
 * There is no router any more.
 *
 * @tanstack/react-router cost 23 KB gzipped on the critical path of an app with
 * one screen, no links and two query parameters. Its six jobs are now done by
 * `src/lib/useSearch.ts` (read/write `?day=` and `?week=`), `menu-resource.ts`
 * plus `use()` (the loader), `<Suspense>` (the pending component) and
 * `<ErrorBoundary>` (the error component) — see App.tsx.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      refetchOnWindowFocus: false,
    },
  },
});

const rootElement = document.getElementById("root");
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>
  );
}
