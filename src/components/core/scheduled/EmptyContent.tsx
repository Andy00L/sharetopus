// components/core/scheduled/EmptyContent.server.tsx

import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function EmptyContent() {
  return (
    <div className="text-center p-8">
      <Clock className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="text-lg font-medium mb-2">No scheduled posts</h3>
      <p className="text-muted-foreground mb-4">
        You haven&apos;t scheduled any posts yet. When you do, they&apos;ll
        appear here.
      </p>
      <Button asChild>
        <Link href="/create">Schedule New Post</Link>
      </Button>
    </div>
  );
}
