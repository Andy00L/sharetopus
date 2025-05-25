"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import user1 from "../../../../public/logo_256x256.ico";
import user2 from "../../../../public/userdemo2.webp";
import user3 from "../../../../public/userdemo3.webp";
import user4 from "../../../../public/userdemo1 .webp";
import user5 from "../../../../public/userdemo5.webp";
export function AnimatedTestimonial() {
  const [currentIndex, setCurrentIndex] = useState(0);

  const userTypes = [
    "entrepreneurs",
    "small business owners",
    "creators",
    "marketers",
    "agencies",
  ];

  // Auto-switch text every 3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentIndex((prevIndex) =>
        prevIndex === userTypes.length - 1 ? 0 : prevIndex + 1
      );
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center sm:flex-row sm:items-center sm:justify-start">
      {/* Overlapping Profile Pictures */}
      <div className="flex -space-x-2 mr-3">
        <Image
          src={user1}
          alt="User"
          width={48}
          height={48}
          className="rounded-full border-5 border-white relative z-10"
        />
        <Image
          src={user2}
          alt="User"
          width={48}
          height={48}
          className="rounded-full border-5 border-white relative z-9"
        />
        <Image
          src={user3}
          alt="User"
          width={48}
          height={48}
          className="rounded-full border-5 border-white relative z-8"
        />
        <Image
          src={user4}
          alt="User"
          width={48}
          height={48}
          className="rounded-full border-5 border-white relative z-7"
        />
        <Image
          src={user5}
          alt="User"
          width={48}
          height={48}
          className="rounded-full border-5 border-white relative z-6"
        />
      </div>

      {/* Stars */}
      <div className="flex flex-col items-center sm:items-start">
        {/* Stars on top */}
        <div className="flex mb-1">
          {[...Array(5)].map((_, i) => (
            <svg
              key={i}
              className="w-4 h-4 text-yellow-400 fill-current"
              viewBox="0 0 20 20"
            >
              <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z" />
            </svg>
          ))}
        </div>

        {/* Animated Text below */}
        <div className="text-sm text-muted-foreground">
          <span>Loved by </span>
          <span className="font-semibold text-foreground">7447 </span>
          <span>{userTypes[currentIndex]}</span>
        </div>
      </div>
    </div>
  );
}
