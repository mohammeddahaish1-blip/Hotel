import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker / own server (infra/): self-contained server.js. Vercel builds leave this unset.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // Expense receipts are uploaded through a Server Action (photos are downscaled in the browser first)
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  // Authenticated, per-request app: classic dynamic rendering.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
