import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Katalog roboczy = ten projekt (jest inny lockfile w katalogu domowym)
  turbopack: { root: __dirname },
};

export default nextConfig;
