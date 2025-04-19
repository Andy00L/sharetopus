import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb", // Increase to 10MB or adjust as needed
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
        pathname: "/**", // Allow all paths on i.pinimg.com
      },
    ],
  },
};

export default nextConfig;
