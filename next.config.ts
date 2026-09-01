import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Emits .next/standalone with only the traced dependencies, so the runtime
  // image ships ~200MB instead of the full node_modules tree.
  output: "standalone",
};

export default nextConfig;
