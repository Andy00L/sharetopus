import Image from "next/image";
import Link from "next/link";
import { default as user1, default as user2 } from "../../../public/logo.png";

export default function Hero() {
  return (
    <section className="w-full flex justify-center py-12 md:py-20">
      <div className="container mx-auto px-4">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-block px-3 py-1 mb-6 rounded-full bg-primary/10 text-primary font-medium">
            Social Media Management Simplified
          </div>

          <h1 className="text-5xl md:text-6xl font-bold leading-tight tracking-tight mb-6">
            <span className="inline-block">Post Once,</span>{" "}
            <span className="inline-block text-primary">Share Everywhere</span>
          </h1>

          <p className="text-xl text-foreground/80 mb-8 leading-relaxed">
            Connect all your social accounts. Create content once. Publish
            everywhere. Sharetopus saves you time by streamlining your social
            media workflow across TikTok, Instagram, Facebook, Threads, and
            YouTube.
          </p>

          <div className="flex flex-wrap justify-center gap-4 mt-10">
            <Link
              href="/dashboard"
              className="bg-primary text-primary-foreground px-6 py-3 rounded-md text-base font-medium hover:bg-primary/90"
            >
              Start posting smarter
            </Link>
            <Link
              href="#features"
              className="bg-transparent border border-primary/20 text-foreground px-6 py-3 rounded-md text-base font-medium hover:bg-primary/10"
            >
              See how it works
            </Link>
          </div>

          <div className="mt-8 flex items-center justify-center">
            <div className="flex -space-x-2">
              <Image
                src={user1}
                alt="User"
                width={32}
                height={32}
                className="rounded-full border-2 border-background"
              />
              <Image
                src={user2}
                alt="User"
                width={32}
                height={32}
                className="rounded-full border-2 border-background"
              />
            </div>
            <span className="ml-3 text-sm text-muted-foreground">
              Join thousands of content creators and social media managers
            </span>
          </div>

          <div className="mt-16 flex flex-wrap justify-center items-center gap-6">
            <div className="flex flex-col items-center">
              <svg
                className="h-8 w-8 text-[#000000]"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
              </svg>
              <span className="mt-1 text-xs">TikTok</span>
            </div>
            <div className="flex flex-col items-center">
              <svg
                className="h-8 w-8 text-[#E1306C]"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
              </svg>
              <span className="mt-1 text-xs">Instagram</span>
            </div>
            <div className="flex flex-col items-center">
              <svg
                className="h-8 w-8 text-[#1877F2]"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
              </svg>
              <span className="mt-1 text-xs">Facebook</span>
            </div>
            <div className="flex flex-col items-center">
              <svg
                className="h-8 w-8 text-[#000000]"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 1C5.9 1 1 5.9 1 12s4.9 11 11 11 11-4.9 11-11S18.1 1 12 1zm0 19c-4.4 0-8-3.6-8-8s3.6-8 8-8 8 3.6 8 8-3.6 8-8 8z" />
                <path d="M8 11.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5S10.3 13 9.5 13 8 12.3 8 11.5zm5 0c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5-.7 1.5-1.5 1.5-1.5-.7-1.5-1.5z" />
                <path d="M12 15c-1.5 0-2.7-.4-3.9-1.1-.2-.1-.3-.3-.2-.5.1-.2.3-.3.5-.2 1 .6 2.1 1 3.6 1s2.6-.3 3.6-1c.2-.1.4 0 .5.2.1.2 0 .4-.2.5-1.2.7-2.4 1.1-3.9 1.1z" />
              </svg>
              <span className="mt-1 text-xs">Threads</span>
            </div>
            <div className="flex flex-col items-center">
              <svg
                className="h-8 w-8 text-[#FF0000]"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
              </svg>
              <span className="mt-1 text-xs">YouTube</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
