import Image from "next/image";
const PLATFORMS = [
  { alt: "Twitter/X", src: "/x.svg" },
  { alt: "Instagram", src: "/instagram.svg" },
  { alt: "LinkedIn", src: "/linkedin.svg" },
  { alt: "Facebook", src: "/facebook.svg" },
  { alt: "TikTok", src: "/tiktok.svg" },
  { alt: "Bluesky", src: "/bluesky.svg" },
  { alt: "YouTube", src: "/youtube.svg" },
  { alt: "Threads", src: "/threads.svg" },
  { alt: "Pinterest", src: "/pinterest.svg" },
];

export default function PlatformsListe({
  message,
}: Readonly<{ message?: string }>) {
  return (
    <div className=" sm:flex flex-col items-center justify-center">
      <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 text-base-content/80">
        <span className="text-xs sm:text-sm">
          <span className="hidden sm:inline">
            {message ?? "All platforms:"}
          </span>
        </span>

        {/* grille mobile (3×3) → flex desktop */}
        <div className="grid grid-cols-9 sm:flex items-center gap-3 sm:gap-4">
          {PLATFORMS.map(({ alt, src }) => (
            <div
              key={alt}
              className="relative w-5 h-5 sm:w-6 sm:h-6 tooltip"
              data-tip={alt}
            >
              {/* version “fill” : 100 % de la div par défaut */}
              <Image
                src={src}
                alt={alt}
                width={24}
                height={24}
                className="object-contain opacity-80 hover:opacity-100 transition-opacity"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
