import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  pageExtensions: ["ts", "tsx", "mdx"],

  typescript: {
    ignoreBuildErrors: true,
  },

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
      // ERC-8004 endpoint domain verification. 8004scan probes this path and
      // accepts the domain once it finds a registrations entry matching the
      // on-chain agent, which the registration file already carries, so the
      // same file answers both paths and there is nothing to keep in sync.
      // sourceRef: https://best-practices.8004scan.io/docs/official-specification/erc-8004-official.md
      {
        source: "/.well-known/agent-registration.json",
        destination: "/.well-known/agent.json",
      },
    ];
  },
};

const withMDX = createMDX({
  extension: /\.mdx?$/,
  options: {
    // String form keeps the config serializable for Turbopack.
    // remark-gfm parses the pipe tables in src/content/docs/*.mdx.
    remarkPlugins: [["remark-gfm"]],
  },
});

export default withMDX(nextConfig);
