import { SidebarContent, SidebarGroup } from "@/components/ui/sidebar";

// components/suspense/Placeholders.tsx
export function ButtonPlaceholder() {
  return <div className="h-9 w-36 bg-muted animate-pulse rounded-md"></div>;
}

export function AccountListPlaceholder() {
  return (
    <div className="h-10 w-full bg-muted/50 rounded-full animate-pulse"></div>
  );
}

export function SectionPlaceholder() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-7 w-24 bg-muted rounded"></div>
        <div className="h-9 w-36 bg-muted rounded-md"></div>
      </div>
      <div className="h-10 w-full bg-muted/50 rounded-full"></div>
    </div>
  );
}

export function MessagePlaceholder() {
  return (
    <div className="h-40 w-full bg-muted/30 rounded-lg animate-pulse"></div>
  );
}

// Account badge skeleton component
function AccountBadgeSkeleton() {
  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded-full border border-gray-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
      <div className="h-8 w-8 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse"></div>
      <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
      <div className="h-4 w-4 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse"></div>
    </div>
  );
}
export default function AccountsPageSkeleton() {
  return (
    <SidebarContent className=" px-4 py-6 ">
      <SidebarGroup className="mb-8">
        <h1 className="text-2xl font-bold">Gérez vos comptes sociaux</h1>
        <div className="h-5 w-3/4 bg-gray-100 dark:bg-gray-800 rounded animate-pulse mt-2"></div>
      </SidebarGroup>

      <SidebarGroup className="mb-8 space-y-6">
        {/* TikTok Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">TikTok</h2>
            <div className="h-9 w-36 bg-gray-100 dark:bg-gray-700 rounded-md animate-pulse"></div>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Account badges placeholders */}
            <AccountBadgeSkeleton />
            <AccountBadgeSkeleton />
          </div>
        </div>

        {/* Pinterest Section */}
        <div className="space-y-3 pt-4 border-t">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Pinterest</h2>
            <div className="h-9 w-36 bg-gray-100 dark:bg-gray-700 rounded-md animate-pulse"></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <AccountBadgeSkeleton />
          </div>
        </div>

        {/* LinkedIn Section */}
        <div className="space-y-3 pt-4 border-t">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">LinkedIn</h2>
            <div className="h-9 w-36 bg-gray-100 dark:bg-gray-700 rounded-md animate-pulse"></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <AccountBadgeSkeleton />
            <AccountBadgeSkeleton />
          </div>
        </div>
      </SidebarGroup>

      {/* Empty state placeholder */}
      <SidebarGroup className="mt-8 mb-16">
        <div className="border border-dashed rounded-lg p-8 text-center bg-gray-50 dark:bg-gray-800/30 animate-pulse">
          <div className="mx-auto h-12 w-12 rounded-full bg-gray-200 dark:bg-gray-700 mb-4"></div>
          <div className="h-6 w-48 bg-gray-200 dark:bg-gray-700 mx-auto rounded mb-2"></div>
          <div className="h-4 w-64 bg-gray-200 dark:bg-gray-700 mx-auto rounded mb-4"></div>
          <div className="h-9 w-36 bg-gray-200 dark:bg-gray-700 mx-auto rounded-md"></div>
        </div>
      </SidebarGroup>
    </SidebarContent>
  );
}
