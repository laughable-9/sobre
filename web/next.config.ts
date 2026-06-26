import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // passkey-kit + its sibling SDK packages ship TypeScript source (no
  // precompiled dist/), so Turbopack needs them on the transpile list.
  transpilePackages: ["passkey-kit", "passkey-kit-sdk", "sac-sdk"],
};

export default nextConfig;
