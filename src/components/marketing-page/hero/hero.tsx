import Image from "next/image";
import Link from "next/link";

import heroImage from "../../../../public/frontend_logo.webp";

import { AnimatedTestimonial } from "./AnimatedTestimonial";
import PlatformsListe from "../details/platformList";

export default function Hero() {
  return (
    <section className="max-w-6xl mx-auto bg-base-100 flex flex-col items-center justify-center px-8 py-8 lg:py-20">
      <div className="container mx-auto px-6">
        <div className="flex flex-col md:flex-row items-center gap-8 ">
          {/* Text content column */}
          <div className="md:w-[60%] text-left md:pr-6">
            <h1 className="text-5xl md:text-6xl font-bold leading-tight  tracking-tight mb-6">
              Share
              <span className="ml-4">Once,</span>
              <br></br>
              Post
              <span className="text-[#FF4A20] ml-4">Everywhere</span>
            </h1>

            <p className="text-xl text-foreground/80 mb-8 leading-relaxed">
              The simplest way to post and grow on all platforms. Built for
              creators and small teams without the ridiculous price tag.
            </p>

            <ul className="space-y-4">
              <li className="flex items-center">
                <div className="rounded-full bg-green-100 p-1 mr-3">
                  <svg
                    className="h-5 w-5 text-green-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
                Post to all major platforms in one click
              </li>
              <li className="flex items-center">
                <div className="rounded-full bg-green-100 p-1 mr-3">
                  <svg
                    className="h-5 w-5 text-green-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
                Schedule content for the perfect posting time
              </li>
              <li className="flex items-center">
                <div className="rounded-full bg-green-100 p-1 mr-3">
                  <svg
                    className="h-5 w-5 text-green-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
                Customize content for each platform
              </li>
              {/**<li className="flex items-center">
                <div className="rounded-full bg-green-100 p-1 mr-3">
                  <svg
                    className="h-5 w-5 text-green-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
                Generate viral videos using our studio templates
              </li>*/}
            </ul>
            <div className="flex flex-wrap mt-10 rounded-full">
              <Link
                href="/create"
                className="bg-[#FF4A20] text-white px-10 py-4 rounded-3xl text-base font-medium hover:bg-[#FF2A11]"
              >
                Try it for free
              </Link>
            </div>

            <div className="mt-8 ">
              <AnimatedTestimonial />
            </div>
          </div>
          <div className="md:w-[40%] mt-12 md:mt-0">
            {/* Add your image here */}
            <div className="bg-gray-200 rounded-lg aspect-video w-full flex items-center justify-center">
              <Image
                src={heroImage}
                height={heroImage.height}
                width={heroImage.width}
                alt="Hero"
              />
            </div>
            {/**Platforms supported */}
            <div className="mt-6 md:mt-8 hidden sm:flex flex-col items-center justify-center">
              <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 text-base-content/80">
                {/* grille mobile (3×3) → flex desktop */}
                {<PlatformsListe />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
