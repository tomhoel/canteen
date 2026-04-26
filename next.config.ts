import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === 'development';

const nextConfig: NextConfig = {
  images: {
    unoptimized: isDev,
  },
  async headers() {
    return [
      {
        source: '/images/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: isDev
              ? 'no-store, no-cache, must-revalidate'
              : 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
      {
        source: '/images_nobg/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: isDev
              ? 'no-store, no-cache, must-revalidate'
              : 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
