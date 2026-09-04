import React, { Suspense } from "react";
import {
  Outlet,
  createRootRoute,
  HeadContent,
} from "@tanstack/react-router";
import { AnimatedGradient } from "@/components/ui/stripe-animated-gradient";

const Toaster = React.lazy(() =>
  import("sonner").then((m) => ({ default: m.Toaster }))
);

const TanStackRouterDevtools =
  process.env.NODE_ENV === "production"
    ? () => null
    : React.lazy(() =>
        import("@tanstack/react-router-devtools").then((res) => ({
          default: res.TanStackRouterDevtools,
        }))
      );

const ReactQueryDevtools =
  process.env.NODE_ENV === "production"
    ? () => null
    : React.lazy(() =>
        import("@tanstack/react-query-devtools").then((res) => ({
          default: res.ReactQueryDevtools,
        }))
      );

export const Route = createRootRoute({
  head: () => ({
    meta: [
      // charSet, viewport, theme-color and the four apple-*/mobile-web-app tags
      // are not repeated here. index.html already ships them, and it has to:
      // they have to be in the document the browser parses, not added by React
      // several hundred milliseconds later. Declaring them twice produced two
      // of each tag in the live DOM.
      //
      // The title stays, because a route may want to change it — but it must
      // match index.html's exactly or the tab renames itself on mount.
      // index.static-shell.test.ts checks that.
      { title: "🍽️ Dagens Lunsj | Telenor Fornebu" },
      {
        name: "description",
        content:
          "Daily lunch menus from The Hub, Telenor Expo, and Bygg B canteens at Telenor Fornebu.",
      },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <>
      <HeadContent />
      <AnimatedGradient
        color1="#f0d090"
        color2="#d4a090"
        color3="#f0bfa0"
        color4="#e8d8c4"
      />
      <Outlet />
      <Suspense fallback={null}>
        <Toaster
          position="top-center"
          richColors
          toastOptions={{
            style: {
              fontFamily: "Outfit, sans-serif",
              borderRadius: "16px",
              boxShadow: "0 12px 32px rgba(60, 30, 0, 0.12)",
            },
          }}
        />
      </Suspense>
      <Suspense fallback={null}>
        <TanStackRouterDevtools position="bottom-right" />
        <ReactQueryDevtools buttonPosition="bottom-left" />
      </Suspense>
    </>
  );
}
