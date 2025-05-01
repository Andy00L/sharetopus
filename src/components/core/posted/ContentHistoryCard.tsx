"use client";

import SocialAvatarWrapper from "@/components/SocialAvatarWrapper";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { ContentHistory } from "@/lib/types/dbTypes";
import { format } from "date-fns";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

interface ContentHistoryCardProps {
  readonly batchId: string;
  readonly items: ContentHistory[];
}

export default function ContentHistoryCard({
  batchId,
  items,
}: ContentHistoryCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const firstItem = items[0];
  const itemDate = new Date(firstItem.created_at!);

  return (
    <>
      <div className="card-container">
        <Card
          className="overflow-hidden border shadow-sm h-full cursor-pointer transition-all duration-200 hover:scale-102 hover:shadow-md hover:bg-accent/50"
          onClick={() => setIsOpen(true)}
        >
          <CardHeader className="p-3 pb-0">
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground font-medium">
                {format(itemDate, "MMM d, yyyy")}
              </span>

              <Badge className={getStatusColorClass(firstItem.status)}>
                {firstItem.status || "unknown"}
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="p-3 pt-2">
            <Badge variant="secondary" className="mb-2">
              {firstItem.media_type ?? "unknown"}
            </Badge>

            <h3 className="font-medium text-sm line-clamp-2 mb-1">
              {firstItem.title || firstItem.description || `Batch ${batchId}`}
            </h3>

            {firstItem.description && firstItem.title && (
              <p className="text-xs text-muted-foreground line-clamp-2">
                {firstItem.description}
              </p>
            )}
          </CardContent>

          <CardFooter className="p-3 pt-0 mt-auto flex justify-between items-center">
            {firstItem.social_accounts && (
              <SocialAvatarWrapper
                src={firstItem.social_accounts.avatar_url}
                alt={`${firstItem.platform} Account`}
                platform={firstItem.platform}
                className="h-10 w-10"
                size={40}
              />
            )}
          </CardFooter>
        </Card>
      </div>

      {/* Alert Dialog (wallet-style) */}
      <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
        <AlertDialogContent className="sm:max-w-[450px]">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Your content was posted to the following platforms
            </AlertDialogTitle>
            <Link href="/create">
              <Button>Create a new post</Button>
            </Link>

            <AlertDialogDescription>
              Posted on {format(itemDate, "MMMM d, yyyy")}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="py-3">
            <h4 className="text-sm font-medium mb-2">Platform</h4>
            <div className="flex items-center gap-3 mb-4">
              <SocialAvatarWrapper
                src={firstItem.social_accounts?.avatar_url}
                alt={`${firstItem.platform} Account`}
                platform={firstItem.platform}
                className="h-12 w-12"
                size={48}
              />
              <div>
                <p className="font-medium capitalize">{firstItem.platform}</p>
                <p className="text-xs text-muted-foreground">
                  Status:{" "}
                  <span className="font-medium">{firstItem.status}</span>
                </p>
              </div>
            </div>

            {firstItem.media_url && (
              <div className="mt-4">
                <div className="flex items-center gap-2 text-sm">
                  <Link
                    href={firstItem.media_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline flex items-center gap-1"
                  >
                    View media <ExternalLink size={14} />
                  </Link>
                </div>
              </div>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function getStatusColorClass(status: string): string {
  switch (status?.toLowerCase()) {
    case "posted":
      return "bg-green-500 hover:bg-green-500/90 text-white";
    case "in_progress":
      return "bg-yellow-500 hover:bg-yellow-500/90 text-white";
    case "failed":
      return "bg-red-500 hover:bg-red-500/90 text-white";
    case "pending":
      return "bg-blue-500 hover:bg-blue-500/90 text-white";
    default:
      return "bg-gray-500 hover:bg-gray-500/90 text-white";
  }
}
