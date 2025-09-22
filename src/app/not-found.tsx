import Image from "next/image";
import Link from "next/link";

import Footer from "@/components/marketing-page/footer";
import Navbar from "@/components/marketing-page/nav-bar/nav-bar";
import { Button } from "@/components/ui/button";
import { Metadata } from "next";
import user1 from "../../public/404.webp";

export const metadata: Metadata = {
  title: "Page Not Found | Your Site Name",
  description: "The page you're looking for cannot be found.",
};

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <div className="h-[calc(100vh-64px)] w-full flex flex-col items-center justify-center px-4 text-center">
        <div className="w-64 h-64 relative flex items-center justify-center">
          <Image
            src={user1}
            alt="Bear silhouette"
            width={256}
            height={256}
            priority
            className="object-contain"
            style={{ maxHeight: "100%", width: "auto" }}
          />
        </div>

        <h1 className="text-5xl font-bold tracking-tight mb-4 text-[#0f172a]">
          Oops! Page not found
        </h1>

        <p className="text-xl text-gray-600 mb-5 max-w-md">
          Looks like this page has wandered off into the woods.
        </p>

        <Button>
          <Link href="/">Return to Homepage</Link>
        </Button>
      </div>
      <Footer />
    </div>
  );
}
