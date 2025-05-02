// components/core/scheduled/ScheduledPostsSkeleton.tsx
import { SidebarContent, SidebarGroup } from "@/components/ui/sidebar";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";

// Individual post card skeleton
function BatchedPostCardSkeleton() {
  return (
    <Card className="overflow-hidden border shadow-sm h-full animate-pulse">
      <CardHeader>
        <div className="flex justify-between items-center">
          {/* Date placeholder */}
          <div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded"></div>
          <div className="flex gap-2">
            {/* Status badge placeholder */}
            <div className="h-5 w-20 bg-gray-200 dark:bg-gray-700 rounded-full"></div>
            {/* Media type badge placeholder */}
            <div className="h-5 w-16 bg-gray-200 dark:bg-gray-700 rounded-full"></div>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="flex flex-col items-center justify-center p-2">
          {/* Content preview placeholder */}
          <div className="w-full">
            {/* Title placeholder */}
            <div className="h-5 w-3/4 bg-gray-200 dark:bg-gray-700 rounded mb-2"></div>
            {/* Description placeholder lines */}
            <div className="h-4 w-full bg-gray-200 dark:bg-gray-700 rounded"></div>
            <div className="h-4 w-2/3 bg-gray-200 dark:bg-gray-700 rounded mt-1"></div>
            <div className="h-4 w-5/6 bg-gray-200 dark:bg-gray-700 rounded mt-1"></div>
          </div>
        </div>
      </CardContent>

      <CardFooter className="p-3 pt-0 mt-auto flex flex-wrap gap-2 items-center">
        {/* Social account avatars placeholders */}
        <div className="h-8 w-8 rounded-full bg-gray-200 dark:bg-gray-700"></div>
        <div className="h-8 w-8 rounded-full bg-gray-200 dark:bg-gray-700"></div>
        <div className="h-8 w-8 rounded-full bg-gray-200 dark:bg-gray-700"></div>
      </CardFooter>
    </Card>
  );
}

// Full grid skeleton
export default function ScheduledPostsSkeleton() {
  return (
    <SidebarContent className="px-4 py-6">
      {/* Header section */}
      <SidebarGroup className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          {/* Title placeholder */}
          <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded mb-2"></div>
          {/* Subtitle placeholder */}
          <div className="h-5 w-64 bg-gray-200 dark:bg-gray-700 rounded"></div>
        </div>

        {/* Button placeholder */}
        <div className="h-9 w-36 bg-gray-200 dark:bg-gray-700 rounded-md ml-auto"></div>
      </SidebarGroup>

      {/* Cards grid */}
      <SidebarGroup className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <BatchedPostCardSkeleton />
        <BatchedPostCardSkeleton />
        <BatchedPostCardSkeleton />
        <BatchedPostCardSkeleton />
        <BatchedPostCardSkeleton />
        <BatchedPostCardSkeleton />
      </SidebarGroup>
    </SidebarContent>
  );
}
