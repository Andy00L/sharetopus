import blueskyIcon from "../../../../public/bluesky.svg";
import facebookIcon from "../../../../public/facebook.svg";
import instagramIcon from "../../../../public/instagram.svg";
import linkedinIcon from "../../../../public/linkedin.svg";
import pinterestIcon from "../../../../public/pinterest.svg";
import threadsIcon from "../../../../public/threads.svg";
import tiktokIcon from "../../../../public/tiktok.svg";
import xIcon from "../../../../public/x.svg";
import youtubeIcon from "../../../../public/youtube.svg";
import Image from "next/image";
const PLATFORMS = [
  { alt: "Twitter/X", src: xIcon },
  { alt: "Instagram", src: instagramIcon },
  { alt: "LinkedIn", src: linkedinIcon },
  { alt: "Facebook", src: facebookIcon },
  { alt: "TikTok", src: tiktokIcon },
  { alt: "Bluesky", src: blueskyIcon },
  { alt: "YouTube", src: youtubeIcon },
  { alt: "Threads", src: threadsIcon },
  { alt: "Pinterest", src: pinterestIcon },
] as const;

export default function PlatformsListe({
  message,
}: Readonly<{ message?: string }>) {
  return (
    <div className="mt-6 md:mt-8 hidden sm:flex flex-col items-center justify-center">
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
                priority={false} /* lazy loading implicite */
                style={{ width: "24px", height: "24px" }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
