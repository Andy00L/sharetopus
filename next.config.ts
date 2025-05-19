import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },

  /* config options here */
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.tiktok**.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "i.pinimg.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "media.licdn.com", // LinkedIn media domain
        port: "",
        pathname: "/**", // Allow any path
      },
      {
        protocol: "https",
        hostname: "qgotbtbdouetxjjdoysz.supabase.co", // Supabase
        port: "",
        pathname: "/**", // Allow any path
      },
    ],
  },
};

export default nextConfig;
