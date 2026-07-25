import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import {
  getPlatformBrandIcon,
  PlatformLetterBadge,
} from "@/components/icons/platformBrandIcons";
import { SubscriptionPrompt } from "@/components/SubscriptionPrompt";
import { Card } from "@/components/ui/card";
import { SidebarContent } from "@/components/ui/sidebar";
import { parseSchedulePrefill } from "@/components/core/create/SocialPostForm/state/parseSchedulePrefill";
import { listPlatformsSupportingMediaType } from "@/lib/platforms/capabilities";
import { auth } from "@clerk/nextjs/server";
import { FileText, Image, Video } from "lucide-react";
import Link from "next/link";

export default async function CreatePostPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ date?: string; time?: string }>;
}) {
  const { userId } = await auth();

  // Calendar quick-create links may land here first; forward the picked
  // slot into whichever post type the user chooses.
  const { date, time } = await searchParams;
  const schedulePrefill = parseSchedulePrefill(date, time);
  const scheduleLinkSuffix = schedulePrefill
    ? `?date=${schedulePrefill.date}&time=${schedulePrefill.time}`
    : "";

  // Post types with their supported platforms, read from the shared
  // capability registry (src/lib/platforms/capabilities.ts).
  const postTypes = [
    {
      title: "Text Post",
      icon: FileText,
      href: "/create/text",
      platforms: listPlatformsSupportingMediaType("text"),
    },
    {
      title: "Image Post",
      icon: Image,
      href: "/create/image",
      platforms: listPlatformsSupportingMediaType("image"),
    },
    {
      title: "Video Post",
      icon: Video,
      href: "/create/video",
      platforms: listPlatformsSupportingMediaType("video"),
    },
  ];

  return (
    <SidebarContent className="px-4 py-6">
      <h1 className="text-2xl font-bold mb-8">Create a Social Media Post</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {postTypes.map((type) => (
          <Link href={`${type.href}${scheduleLinkSuffix}`} key={type.title}>
            <Card
              className="
            p-6 h-full flex flex-col items-center justify-between bg-card
            border-2 border-dashed border-muted-foreground/25
            transition-all duration-200 cursor-pointer
            hover:border-solid hover:border-chart-1
            hover:shadow-lg hover:shadow-chart-1/5
            hover:-translate-y-1
          "
            >
              {/* Icon section */}
              <div className="mb-6 transition-transform duration-200 group-hover:scale-110">
                <type.icon className="h-16 w-16  text-muted-foreground transition-colors duration-200 group-hover:text-primary " />
              </div>

              {/* Title section */}
              <h2 className="text-xl font-semibold mb-8  transition-colors duration-200 group-hover:text-primary">
                {type.title}
              </h2>

              {/* Platform icons section */}
              <div className="mt-auto w-full">
                <div className="flex flex-wrap items-center justify-center gap-3">
                  {type.platforms.map((platform) => {
                    const PlatformIcon = getPlatformBrandIcon(platform);
                    return (
                      <span
                        key={platform}
                        className="text-muted-foreground transition-colors [&>svg]:!w-4 [&>svg]:!h-4 duration-200 group-hover:text-primary/80 flex-shrink-0"
                      >
                        {PlatformIcon ? (
                          <PlatformIcon />
                        ) : (
                          <PlatformLetterBadge platform={platform} />
                        )}
                      </span>
                    );
                  })}
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
