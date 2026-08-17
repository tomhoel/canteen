import React, { Suspense } from "react";
import {
  Outlet,
  createRootRoute,
  HeadContent,
} from "@tanstack/react-router";
import { AnimatedGradient } from "@/components/ui/stripe-animated-gradient";

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
      { charSet: "utf-8" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover",
      },
      { name: "theme-color", content: "#f5f0e8" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Dagens Lunsj" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { title: "🍽️ Dagens Lunsj | Telenor Fornebu" },
      {
        name: "description",
        content:
          "Daily lunch menus from The Hub, Telenor Expo, and Bygg B canteens at Telenor Fornebu.",
      },
    ],
    // Deliberately no `links`. index.html is the single owner of them now.
    //
    // Every link this route used to declare — the stylesheet, the manifest, the
    // icons, the font preconnects — was already in index.html, and repeating
    // them here bought nothing but a second copy fetched late: the router can
    // only add them once the JS bundle has booted, so /manifest.json was
    // requested twice and the font stylesheet was not discovered until React's
    // first render. HeadContent only ever appends, so removing them leaves the
    // static tags in index.html untouched.
    //
    // Anything added back here must not already exist in index.html.
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
        <TanStackRouterDevtools position="bottom-right" />
        <ReactQueryDevtools buttonPosition="bottom-left" />
      </Suspense>
    </>
  );
}
