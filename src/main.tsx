import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { routeTree } from "./routeTree.gen";
import "@/styles/globals.css";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      refetchOnWindowFocus: false,
    },
  },
});

const router = createRouter({
  routeTree,
  scrollRestoration: true,
  // TanStack's defaults are 1000/500: hold everything back for a full second,
  // then, once the placeholder is finally shown, keep it up for at least half a
  // second more. That is tuned for a placeholder you would rather not see. Ours
  // is the app's own shell — header, dates, day bar, three card outlines — so
  // there is nothing to hide and no reason to make the user stare at an empty
  // screen first. 200ms is long enough that a warm load goes straight to the
  // menu without a flicker; a minimum of 0 lets the data replace the shell the
  // Render the skeleton shell immediately with 0ms delay if data is in flight;
  // with defaultPendingMinMs: 0, the real content replaces it the instant it resolves.
  defaultPendingMs: 0,
  defaultPendingMinMs: 0,
  context: {
    queryClient,
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (rootElement && !rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </React.StrictMode>
  );
}
