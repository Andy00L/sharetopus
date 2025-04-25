import { ThemeProvider } from "@/actions/ui/Theme-provider";
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
    "Post to all your socials in one go. Saves you time, lets you tweak content per platform, and tracks how your posts perform.",

  // Basic metadata
  keywords:
    "social media management, multi-platform posting, content scheduling, social media analytics, share content, post to multiple platforms, social media tool, content distribution, social media automation, cross-platform posting, social media dashboard, social media marketing, sharetopus, post everywhere",

  authors: [{ name: "Sharetopus Team" }],
  publisher: "Sharetopus Inc.",

  // Canonical URL - replace with your actual domain
  metadataBase: new URL("https://sharetopus.com"),

  // Open Graph metadata for social sharing
  openGraph: {
    title: "Sharetopus | Post once, share everywhere",
    description:
      "Post to all your socials in one go. Saves you time, lets you tweak content per platform, and tracks how your posts perform.",
    url: "https://sharetopus.com",
    siteName: "sharetopus",
    locale: "en_CA",
    type: "website",
    images: [
      //TO DO
      {
        url: "@/../public/logo.png", // Create a 1200x630 image for social sharing
        width: 1200,
        height: 630,
        alt: "sharetopus - Post once, share everywhere",
      },
    ],
  },

  // Twitter card metadata
  //TO DO
  twitter: {
    card: "summary_large_image",
    title: "Sharetopus | Post once, share everywhere",
    description:
      "Post to all your socials in one go. Saves you time, lets you tweak content per platform, and tracks how your posts perform.",
    images: "@/../public/logo.png",
    creator: "@sharetopus",
  },

  // Robots directives
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      noimageindex: false,
    },
  },

  // Verification for search consoles (add your actual codes)
  verification: {
    google: "google-site-verification-code",
    yandex: "yandex-verification-code",
  },

  // Combined alternates property
  alternates: {
    canonical: "https://sharetopus.com/app",
    languages: {
      "en-CA": "https://sharetopus.com",
      "fr-CA": "https://sharetopus.com/fr",
    },
  },

  // Additional useful metadata
  applicationName: "Sharetopus", // For homescreen icons on mobile
  icons: {
    icon: "@/../public/logo_16x16.ico", // Ensure this exists in public/
    shortcut: "@/../public/logo_16x16.ico",
    apple: "@/../public/logo_16x16.ico", // For Apple devices
  },
  referrer: "strict-origin-when-cross-origin", // Security for referrer data
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ClerkProvider>
          <ThemeProvider>{children}</ThemeProvider>
          <Toaster />
          <Analytics />
          <SpeedInsights />
        </ClerkProvider>
      </body>
    </html>
  );
}
