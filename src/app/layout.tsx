import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { ClerkProvider } from "@clerk/nextjs";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sharetopus | Post once, share everywhere",
  description:
    "Post to all your socials in one go. Saves you time and lets you tweak content per platform",

  keywords:
    "social media management, multi-platform posting, content scheduling, share content, post to multiple platforms, social media tool, content distribution, social media automation, cross-platform posting, social media dashboard, social media marketing, sharetopus, post everywhere",

  authors: [{ name: "Sharetopus Team" }],
  publisher: "Sharetopus Inc.",

  metadataBase: new URL("https://sharetopus.com"),

  openGraph: {
    title: "Sharetopus | Post once, share everywhere",
    description:
      "Post to all your socials in one go. Saves you time and lets you tweak content per platform.",
    url: "https://sharetopus.com",
    siteName: "sharetopus",
    locale: "en_CA",
    type: "website",
    images: [
      {
        url: "/social_sharing.webp",
        width: 1200,
        height: 630,
        alt: "sharetopus - Post once, share everywhere",
      },
    ],
  },

  twitter: {
    card: "summary_large_image",
    title: "Sharetopus | Post once, share everywhere",
    description:
      "Post to all your socials in one go. Saves you time and lets you tweak content per platform.",
    images: "/social_sharing.webp",
    creator: "@sharetopus",
  },

  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      noimageindex: false,
    },
  },

  alternates: {
    canonical: "https://sharetopus.com",
    languages: {
      "en-CA": "https://sharetopus.com",
      "fr-CA": "https://sharetopus.com/fr",
    },
  },

  applicationName: "Sharetopus",
  icons: {
    icon: "/logo_16x16.ico",
    shortcut: "/logo_16x16.ico",
    apple: "/logo_16x16.ico",
  },
  referrer: "strict-origin-when-cross-origin",

  // Base app ownership verification tag. Renders as
  // <meta name="base:app_id" content="..."> in <head> on every page,
  // including the homepage where the verifier looks for it.
  other: {
    "base:app_id": "6a7c480cbb30de7bbb11891a",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // next-themes updates <html> before hydration; its README requires
    // suppressHydrationWarning here (node_modules/next-themes/README.md:95).
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable}  antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <ClerkProvider>
            {children}
            <Toaster />
            <Analytics />
            <SpeedInsights />
          </ClerkProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
