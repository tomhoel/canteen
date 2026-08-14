import React, { Suspense } from "react";
import {
  Outlet,
  createRootRoute,
  HeadContent,
} from "@tanstack/react-router";
import { AnimatedGradient } from "@/components/ui/stripe-animated-gradient";
import globalCss from "@/styles/globals.css?url";

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
    links: [
      { rel: "stylesheet", href: globalCss },
      // These must mirror index.html. The router rewrites the head at runtime,
      // so a stale entry here silently wins over the correct static one — which
      // is how /favicon.ico came back after index.html stopped referencing it.
      // There is no favicon.ico in public/, and the SPA rewrite answers the
      // request with index.html, so the browser was parsing HTML as an icon.
      { rel: "manifest", href: "/manifest.json" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
      { rel: "icon", type: "image/svg+xml", href: "/icon.svg" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&display=swap",
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
        <TanStackRouterDevtools position="bottom-right" />
        <ReactQueryDevtools buttonPosition="bottom-left" />
      </Suspense>
    </>
  );
}
