// components/ComingSoon.server.tsx
import React from "react";

export default function ComingSoon() {
  return (
    <div className="flex items-center justify-center min-h-[70vh]  w-full">
      <div className="relative">
        <h1 className="font-black  tracking-tight text-5xl sm:text-6xl md:text-7xl lg:text-8xl text-center">
          COMING SOON
        </h1>

        {/* Elegant divider */}
        <div className="h-px w-full max-w-lg mx-auto mt-6 bg-gradient-to-r from-transparent via-black to-transparent opacity-20" />

        {/* Static design elements for depth */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-gradient-to-br from-black/5 to-transparent rounded-full blur-3xl -z-10" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-gradient-to-br from-black/5 to-transparent rounded-full blur-3xl -z-10" />
      </div>
    </div>
  );
}
