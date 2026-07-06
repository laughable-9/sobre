import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // passkey-kit + its sibling SDK packages ship TypeScript source (no
  // precompiled dist/), so Turbopack needs them on the transpile list.
  transpilePackages: ["passkey-kit", "passkey-kit-sdk", "sac-sdk"],
  experimental: {
    // React <ViewTransition> integration — the shared SiteHeader morphs
    // between its landing and dashboard variants on route navigation.
    // Degrades gracefully (no animation) where the browser lacks support.
    viewTransition: true,
  },
};

export default nextConfig;
