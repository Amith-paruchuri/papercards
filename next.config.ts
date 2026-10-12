import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Classic dynamic rendering: every page here is per-user and authenticated.
  poweredByHeader: false,
};

export default nextConfig;
