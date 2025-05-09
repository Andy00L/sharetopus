// components/core/history/EmptyContentHistory.tsx
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function EmptyContentHistory() {
  return (
    <div className="text-center p-8">
      <History className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="text-lg font-medium mb-2">No Content History</h3>
      <p className="text-muted-foreground mb-4">
        You haven&apos;t created any content yet.
      </p>
      <Button asChild>
        <Link href="/create">Create New Content</Link>
      </Button>
    </div>
  );
}
