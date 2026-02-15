import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Only export when building, not in dev
  ...(process.env.NODE_ENV === 'production' ? {
    output: "export",
    distDir: "dist",
  } : {}),
  images: {
    unoptimized: true,
  },
  // Disable caching for images during development
  async headers() {
    return [
      {
        source: '/images/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate',
          },
        ],
      },
      {
        source: '/images_nobg/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
