import Image from "next/image";
import Link from "next/link";

import Footer from "@/components/marketing-page/footer";
import Navbar from "@/components/marketing-page/nav-bar/nav-bar";
import { Metadata } from "next";
import user1 from "../../../public/404.webp";

export const metadata: Metadata = {
  title: "Page Not Found | Your Site Name",
  description: "The page you're looking for cannot be found.",
};

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center px-6 py-12 max-w-2xl mx-auto">
          <div className="mb-8 flex justify-center">
            <Image
              src={user1} // Updated to webp format
              alt="Bear silhouette"
              width={180}
              height={180}
              priority
            />
          </div>
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            Oops! Page not found
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            Looks like this page has wandered off into the woods.
          </p>
          <Link
            href="/"
            className="inline-block px-6 py-3 rounded-md bg-black text-white font-medium hover:bg-gray-800 transition-colors"
          >
            Return to Homepage
          </Link>
        </div>
      </div>
      <Footer />
    </div>
  );
}
