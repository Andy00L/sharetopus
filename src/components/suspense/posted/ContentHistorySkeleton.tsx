// components/core/posted/ContentHistorySkeleton.tsx
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";

// Individual content history card skeleton
function ContentHistoryCardSkeleton() {
  return (
    <Card className="overflow-hidden border shadow-sm h-full animate-pulse">
      <CardHeader>
        <div className="flex justify-between items-center">
          {/* Date placeholder */}
          <div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded"></div>
          {/* Status badge placeholder */}
          <div className="h-5 w-20 bg-gray-200 dark:bg-gray-700 rounded-full"></div>
        </div>
      </CardHeader>

      <CardContent>
        {/* Media type badge placeholder */}
        <div className="h-5 w-24 bg-gray-200 dark:bg-gray-700 rounded-full mb-2"></div>

        {/* Title placeholder */}
        <div className="h-5 w-full bg-gray-200 dark:bg-gray-700 rounded mb-2"></div>

        {/* Description placeholder */}
        <div className="h-4 w-full bg-gray-200 dark:bg-gray-700 rounded"></div>
        <div className="h-4 w-3/4 bg-gray-200 dark:bg-gray-700 rounded mt-1"></div>
      </CardContent>

      <CardFooter className="p-3 pt-0 mt-auto flex flex-wrap gap-2 items-center">
        {/* Social account avatars placeholders */}
        <div className="h-10 w-10 rounded-full bg-gray-200 dark:bg-gray-700"></div>
        <div className="h-10 w-10 rounded-full bg-gray-200 dark:bg-gray-700"></div>
        <div className="h-10 w-10 rounded-full bg-gray-200 dark:bg-gray-700"></div>
      </CardFooter>
    </Card>
  );
}

// Full grid skeleton
export default function ContentHistorySkeleton() {
  return (
    <div className="p-4 w-full">
      {/* Header section 
      <div className="mb-6">
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded mb-2"></div>
        <div className="h-5 w-64 bg-gray-200 dark:bg-gray-700 rounded"></div>
      </div>*/}

      {/* Cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <ContentHistoryCardSkeleton />
        <ContentHistoryCardSkeleton />
        <ContentHistoryCardSkeleton />
        <ContentHistoryCardSkeleton />
        <ContentHistoryCardSkeleton />
        <ContentHistoryCardSkeleton />
        <ContentHistoryCardSkeleton />
        <ContentHistoryCardSkeleton />
      </div>
    </div>
  );
}
