import { SidebarGroup } from "../../ui/sidebar";

export default function SocialPostFormSkeleton() {
  return (
    <SidebarGroup className="w-full max-w-3xl mx-auto">
      <div className="space-y-4">
        {/* Step progress skeleton */}
        <div className="w-full h-8 bg-gray-100 dark:bg-gray-700 rounded-md animate-pulse mb-6"></div>

        <h1 className="text-2xl font-bold">Create a post</h1>

        {/* Tabs skeleton */}
        <div className="w-full grid grid-cols-2 gap-1 bg-gray-100 dark:bg-gray-700 rounded-md h-10 mb-2"></div>

        {/* Upload area skeleton */}
        <div className="border-2 border-dashed rounded-lg p-12 bg-gray-50 dark:bg-gray-800 animate-pulse">
          <div className="w-full h-full flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-gray-200 dark:bg-gray-600 mb-4"></div>
            <div className="h-6 bg-gray-200 dark:bg-gray-600 w-48 rounded mb-2"></div>
            <div className="h-4 bg-gray-200 dark:bg-gray-600 w-36 rounded mb-1"></div>
            <div className="h-3 bg-gray-200 dark:bg-gray-600 w-72 rounded"></div>
          </div>
        </div>

        {/* Button skeleton */}
        <div className="w-full h-10 bg-gray-200 dark:bg-gray-600 rounded-md animate-pulse mt-6"></div>
      </div>
    </SidebarGroup>
  );
}
