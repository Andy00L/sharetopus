/**import blueskyIcon from "../../../../public/bluesky.svg";
import facebookIcon from "../../../../public/facebook.svg";
import instagramIcon from "../../../../public/instagram.svg";
import linkedinIcon from "../../../../public/linkedin.svg";
import pinterestIcon from "../../../../public/pinterest.svg";
import threadsIcon from "../../../../public/threads.svg";
import tiktokIcon from "../../../../public/tiktok.svg";
import xIcon from "../../../../public/x.svg";
import youtubeIcon from "../../../../public/youtube.svg";*/
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
              <img
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
