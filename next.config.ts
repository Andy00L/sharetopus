import type { NextConfig } from "next";
import createMDX from "@next/mdx";

const nextConfig: NextConfig = {
  pageExtensions: ["ts", "tsx", "mdx"],

  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },

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
        hostname: "media.licdn.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "qgotbtbdouetxjjdoysz.supabase.co",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "scontent-iad3-2.cdninstagram.com",
        port: "",
        pathname: "/**",
      },
    ],
  },

  async rewrites() {
    return [
      // Serve MDX docs as raw markdown for AI agents and CLI tools.
      { source: "/docs/:slug.md", destination: "/api/docs/:slug" },
    ];
  },
};

const withMDX = createMDX({ extension: /\.mdx?$/ });

export default withMDX(nextConfig);
