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
        hostname: "p16-pu-sign-no.tiktokcdn-eu.com", // Add the specific hostname
        port: "",
        pathname: "/tos-no1a-avt-0068c001-no/**", // Allow any path under this prefix
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
