import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Output a self-contained `.next/standalone/` bundle so the Docker
  // image only needs `node` + the standalone tree (no node_modules
  // copy at runtime). PRD §13.
  output: "standalone",
};

export default nextConfig;
