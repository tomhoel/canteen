import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lunch | Telenor Fornebu",
  description: "Daily lunch menus from The Hub, Telenor Expo, and Bygg B canteens at Telenor Fornebu.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Lunch",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
  // Prevent caching
  other: {
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F2F2F7" },
    { media: "(prefers-color-scheme: dark)", color: "#1C1C1E" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="no">
      <head>
        <meta httpEquiv="Cache-Control" content="no-store, no-cache, must-revalidate" />
        <meta httpEquiv="Pragma" content="no-cache" />
        <meta httpEquiv="Expires" content="0" />
      </head>
      <body suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
