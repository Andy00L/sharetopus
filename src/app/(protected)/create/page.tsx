import PinterestSVGIcon, {
  FacebookSVGIcon,
  InstagramSVGIcon,
  LinkedinSVGIcon,
  ThreadsSVGIcon,
  TiktokSVGIcon,
  TwitterVGIcon,
} from "@/components/icons/allPlatformsIcons";
import { Card } from "@/components/ui/card";
import { SidebarContent } from "@/components/ui/sidebar";
import { FileText, Image, Video } from "lucide-react";
import Link from "next/link";
import React from "react";

export default async function CreatePostPage() {
  // Define the post types with their supported platforms
  const postTypes = [
    {
      title: "Text Post",
      icon: FileText,
      href: "/create/text",
      platforms: ["linkedin"],
    },
    {
      title: "Image Post",
      icon: Image,
      href: "/create/image",
      platforms: ["linkedin", "pinterest", "tiktok"],
    },
    {
      title: "Video Post",
      icon: Video,
      href: "/create/video",
      platforms: ["linkedin", "pinterest", "tiktok"],
    },
  ];

  // Map platform names to their icon components
  const platformIcons = {
    facebook: FacebookSVGIcon,
    twitter: TwitterVGIcon,
    linkedin: LinkedinSVGIcon,
    threads: ThreadsSVGIcon,
    instagram: InstagramSVGIcon,
    pinterest: PinterestSVGIcon,
    tiktok: TiktokSVGIcon,
  };

  return (
    <SidebarContent className="px-4 py-6">
      <h1 className="text-2xl font-bold mb-8">Create a Social Media Post</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {postTypes.map((type) => (
          <Link href={type.href} key={type.title}>
            <Card
              className="
            p-6 h-full flex flex-col items-center justify-between bg-card
            border-2 border-dashed border-muted-foreground/25
            transition-all duration-200 cursor-pointer
            hover:border-solid hover:border-primary
            hover:shadow-lg hover:shadow-primary/5
            hover:-translate-y-1
          "
            >
              {/* Icon section */}
              <div className="mb-6 transition-transform duration-200 group-hover:scale-110">
                <type.icon className="h-16 w-16 text-muted-foreground transition-colors duration-200 group-hover:text-primary" />
              </div>

              {/* Title section */}
              <h2 className="text-xl font-semibold mb-8 transition-colors duration-200 group-hover:text-primary">
                {type.title}
              </h2>

              {/* Platform icons section */}
              <div className="mt-auto w-full">
                <div className="flex flex-wrap items-center justify-center gap-3">
                  {type.platforms.map((platform) =>
                    platformIcons[platform as keyof typeof platformIcons] ? (
                      <span
                        key={platform}
                        className="text-muted-foreground transition-colors [&>svg]:!w-4 [&>svg]:!h-4 duration-200 group-hover:text-primary/80 flex-shrink-0"
                      >
                        {React.createElement(
                          platformIcons[platform as keyof typeof platformIcons]
                        )}
                      </span>
                    ) : null
                  )}
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      {/* Footer section remains the same */}
      <div className="text-center">
        <Link
          href="/connections"
          className="text-sm text-muted-foreground hover:text-primary inline-flex items-center gap-1 transition-colors duration-200"
        >
          <span className="text-green-500">●</span>
          You can connect more accounts here
        </Link>
      </div>
    </SidebarContent>
  );
}
