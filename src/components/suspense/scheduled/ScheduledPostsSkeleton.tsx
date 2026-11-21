import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { SidebarGroup } from "@/components/ui/sidebar";

function BatchedPostCardSkeleton() {
  return (
    <Card className="overflow-hidden border shadow-sm h-full animate-pulse">
      <CardHeader>
        <div className="flex justify-between items-center">
          <div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded"></div>
          <div className="flex gap-2">
            <div className="h-5 w-20 bg-gray-200 dark:bg-gray-700 rounded-full"></div>
            <div className="h-5 w-16 bg-gray-200 dark:bg-gray-700 rounded-full"></div>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="flex flex-col items-center justify-center p-2">
          <div className="w-full">
            <div className="h-5 w-3/4 bg-gray-200 dark:bg-gray-700 rounded mb-2"></div>
            <div className="h-4 w-full bg-gray-200 dark:bg-gray-700 rounded"></div>
            <div className="h-4 w-2/3 bg-gray-200 dark:bg-gray-700 rounded mt-1"></div>
            <div className="h-4 w-5/6 bg-gray-200 dark:bg-gray-700 rounded mt-1"></div>
          </div>
        </div>
      </CardContent>

      <CardFooter className="p-3 pt-0 mt-auto flex flex-wrap gap-2 items-center">
        <div className="h-8 w-8 rounded-full bg-gray-200 dark:bg-gray-700"></div>
        <div className="h-8 w-8 rounded-full bg-gray-200 dark:bg-gray-700"></div>
        <div className="h-8 w-8 rounded-full bg-gray-200 dark:bg-gray-700"></div>
      </CardFooter>
    </Card>
  );
}

export default function ScheduledPostsSkeleton() {
  return (
    <SidebarGroup className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <BatchedPostCardSkeleton />
      <BatchedPostCardSkeleton />
      <BatchedPostCardSkeleton />
      <BatchedPostCardSkeleton />
      <BatchedPostCardSkeleton />
      <BatchedPostCardSkeleton />
    </SidebarGroup>
  );
}
