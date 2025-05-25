import { JSX } from "react";

import drewecom from "../../../public/drewecom.jpg";
import quinn from "../../../public/quinn.jpg";
import AvatarWithFallback from "../AvatarWithFallback";
import { StaticImageData } from "next/image";

const testimonials: Testimonial[] = [
  {
    name: "Andrew ",
    avatar: drewecom,
    rating: 5,
    text: "Helped me make $96k in profit last month on tiktok shop. Shoutout to  @Andy00L for the software",
    links: [
      {
        href: "",
        label: "See TikTok page",
        icon: (
          <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
          </svg>
        ),
      },
      {
        href: " ",
        label: "Watch video",
        icon: (
          <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 24 24">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        ),
      },
    ],
  },
  {
    name: "Quinn ",
    avatar: quinn,
    rating: 5,
    text: "[Sharetopus] responded within 10 mins [of support request], fixed and shipped in under an hour, the type of founders I’m happy to support",
    links: [
      {
        href: "",
        label: "View Tweet",
        icon: (
          <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 24 24">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        ),
      },
    ],
  },
];
// Define the shape of our testimonial data
interface Testimonial {
  name: string;
  avatar: StaticImageData;
  rating: number; // 1-5 stars
  text: string;
  links: Array<{
    href: string;
    label: string;
    icon: JSX.Element;
  }>;
}

// Reusable star component
const StarIcon = () => (
  <svg className="w-4 h-4 text-yellow-400 fill-current" viewBox="0 0 20 20">
    <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z" />
  </svg>
);

// Reusable testimonial card component
function TestimonialCard({ testimonial }: { testimonial: Testimonial }) {
  return (
    <div className="p-4 bg-[#EEEFE8] border border-[#DADBD2] flex items-start text-left rounded-[16px] shadow ">
      <AvatarWithFallback
        src={testimonial.avatar.src}
        alt={`${testimonial.name} ReelFarm`}
        className="w-12 h-12"
      />
      <div className="ml-3">
        <div className="flex mb-1">
          {[...Array(5)].map((_, i) => (
            <StarIcon key={i} />
          ))}
        </div>
        <p className="text-sm font-semibold text-[#191919]">
          {testimonial.name}
        </p>
        <p className="text-sm text-[#777] mr-4">{testimonial.text}</p>

        <div className="flex gap-3 mt-2">
          {/** {testimonial.links.map((link, idx) => (
            <Link
              key={idx}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline flex items-center"
            >
              {link.icon}
              {link.label}
            </Link>
          ))} */}
        </div>
      </div>
    </div>
  );
}

// Main component
export default function TestimonialsSection() {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-10  mt-4 mb-4 z-99">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-[900px]">
        {testimonials.map((testimonial, index) => (
          <TestimonialCard key={index} testimonial={testimonial} />
        ))}
      </div>
    </div>
  );
}
