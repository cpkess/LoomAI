import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Served with `next start` (see Dockerfile) so the container can rebuild
  // itself on self-update; no standalone bundle needed.
  serverExternalPackages: ["pdf-parse", "playwright-core", "@turbodocx/html-to-docx"],
};

export default nextConfig;
