"use client";
import Image from "next/image";
import blueskyIcon from "../../../public/bluesky.svg";
import facebookIcon from "../../../public/facebook.svg";
import instagramIcon from "../../../public/instagram.svg";
import linkedinIcon from "../../../public/linkedin.svg";
import pinterestIcon from "../../../public/pinterest.svg";
import threadsIcon from "../../../public/threads.svg";
import tiktokIcon from "../../../public/tiktok.svg";
import xIcon from "../../../public/x.svg";
import youtubeIcon from "../../../public/youtube.svg";
const partners = [
  { name: "Twitter/X", logo: xIcon },
  { name: "Instagram", logo: instagramIcon },
  { name: "LinkedIn", logo: linkedinIcon },
  { name: "Facebook", logo: facebookIcon },
  { name: "TikTok", logo: tiktokIcon },
  { name: "Bluesky", logo: blueskyIcon },
  { name: "YouTube", logo: youtubeIcon },
  { name: "Threads", logo: threadsIcon },
  { name: "Pinterest", logo: pinterestIcon },
];

export default function Partners() {
  return (
    <>
      <style jsx>{`
        @keyframes infinite-scroll {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-100%);
          }
        }

        .animate-infinite-scroll {
          display: flex;
          animation: infinite-scroll 30s linear infinite;
          will-change: transform;
          white-space: nowrap;
        }

        .animate-infinite-scroll:hover {
          animation-play-state: paused;
        }

        .platform-item {
          display: flex;
          align-items: center;
          flex-shrink: 0;
          margin: 0 20px;
        }

        .platform-logo {
          width: 48px;
          height: 48px;
          margin-right: 8px;
        }

        .platform-name {
          font-size: 0.875rem;
          color: #4b5563;
        }
      `}</style>

      <section className="py-10 ">
        <div className="container px-4 mx-auto max-w-7xl">
          <div className="overflow-hidden">
            <div className="flex animate-infinite-scroll">
              {/* Original Partners */}
              {partners.map((partner, index) => (
                <div key={`${partner.name}-${index}`} className="platform-item">
                  <div className="platform-logo">
                    <Image
                      src={partner.logo.src ?? partner.logo}
                      alt={partner.name}
                      width={48}
                      height={48}
                      className="object-contain opacity-70"
                      style={{ width: "48px", height: "48px" }}
                    />
                  </div>
                  <span className="platform-name font-bold">
                    {partner.name}
                  </span>
                </div>
              ))}

              {/* Duplicate Partners for Seamless Loop */}
              {partners.map((partner, index) => (
                <div
                  key={`duplicate-${partner.name}-${index}`}
                  className="platform-item"
                >
                  <div className="platform-logo">
                    <Image
                      src={partner.logo}
                      alt={partner.name}
                      width={48}
                      height={48}
                      className="object-contain opacity-70"
                    />
                  </div>
                  <span className="platform-name">{partner.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
