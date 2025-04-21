"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { cancelScheduledPost } from "@/actions/server/scheduleActions/cancelScheduledPost";
import { deleteScheduledPost } from "@/actions/server/scheduleActions/deleteScheduledPost";
import { resumeScheduledPost } from "@/actions/server/scheduleActions/resumeScheduledPost";

import {
  AlertDialog,
  AlertDialogAction,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";

import {
  CalendarIcon,
  Check,
  Clock,
  MoreVertical,
  PlayCircle,
  Trash2,
  X,
} from "lucide-react";

import AvatarWithFallback from "@/components/AvatarWithFallback";
import type { ScheduledPost } from "@/lib/types/dbTypes";
import RescheduleDialog from "./RescheduleDialog";

interface Props {
  readonly post: ScheduledPost;
  readonly userId: string | null;
}

export default function PostCard({ post, userId }: Props) {
  const router = useRouter();

  /* ---------- local state ---------- */
  const [loading, setLoading] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  /* -------- helpers -------- */
  const scheduledDate = new Date(post.scheduled_at);
  const formattedDate = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(scheduledDate);

  const avatarUrl = post.social_accounts?.avatar_url ?? "";
  const accountName = post.social_accounts?.display_name ?? "";
  const statusBadge =
    post.status === "scheduled" ? (
      <Badge variant="outline" className="gap-1 text-blue-500 border-blue-200">
        <Clock className="h-3 w-3" />
        Scheduled
      </Badge>
    ) : post.status === "processing" ? (
      <Badge
        variant="outline"
        className="gap-1 text-yellow-500 border-yellow-200"
      >
        <Clock className="h-3 w-3 animate-spin" />
        Processing
      </Badge>
    ) : post.status === "posted" ? (
      <Badge
        variant="outline"
        className="gap-1 text-green-500 border-green-200"
      >
        <Check className="h-3 w-3" />
        Posted
      </Badge>
    ) : post.status === "failed" ? (
      <Badge variant="outline" className="gap-1 text-red-500 border-red-200">
        <X className="h-3 w-3" />
        Failed
      </Badge>
    ) : post.status === "cancelled" ? (
      <Badge variant="outline" className="gap-1 text-red-500 border-gray-200">
        <X className="h-3 w-3" />
        Cancelled
      </Badge>
    ) : (
      <Badge variant="outline">{post.status}</Badge>
    );

  const platformBadge = (
    <Badge variant="secondary" className="capitalize">
      {post.platform}
    </Badge>
  );

  const canCancel = post.status === "scheduled";
  const canResume = post.status === "cancelled";
  const canReschedule = canCancel || canResume;

  /* -------- actions -------- */

  const runAction = async (
    fn: () => Promise<{ success: boolean; message: string }>
  ) => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fn();
      if (res.success) {
        toast.success(res.message);
        router.refresh();
      } else {
        toast.error(res.message);
      }
    } catch (e) {
      toast.error(`Unexpected error+${e}`);
    } finally {
      setLoading(false);
      setMenuOpen(false); // always close the 3‑dots menu
    }
  };

  /* -------- JSX -------- */

  return (
    <>
      {/* -------- Reschedule dialog -------- */}
      <RescheduleDialog
        post={post}
        isOpen={rescheduleOpen}
        onClose={() => setRescheduleOpen(false)}
        userId={userId}
        onSuccess={() => router.refresh()}
      />

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Scheduled Post?</AlertDialogTitle>
            <AlertDialogDescription>
              The media will be preserved so you can reschedule it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Post</AlertDialogCancel>
            <AlertDialogAction
              className="bg-yellow-500 hover:bg-yellow-600"
              onClick={() =>
                runAction(() => cancelScheduledPost(post.id, userId))
              }
            >
              Cancel Post
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* -------- Delete dialog -------- */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Post Permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the post and its media.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Post</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-600"
              onClick={() =>
                runAction(() => deleteScheduledPost(post.id, userId))
              }
            >
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* -------- Card -------- */}
      <Card className="relative">
        {loading && (
          <div className="absolute inset-0 bg-background/50 flex items-center justify-center z-10 rounded-lg">
            <Skeleton className="h-12 w-12 rounded-full" />
          </div>
        )}

        <CardHeader className="pb-3">
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-2">
              {platformBadge}
              {statusBadge}
            </div>

            {/* 3‑dots menu */}
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="z-50">
                {canReschedule && (
                  <DropdownMenuItem
                    className="text-blue-500"
                    onClick={() => {
                      setRescheduleOpen(true);
                      setMenuOpen(false);
                    }}
                  >
                    <CalendarIcon className="h-4 w-4 mr-2" />
                    Reschedule
                  </DropdownMenuItem>
                )}

                {canResume && (
                  <DropdownMenuItem
                    className="text-green-500"
                    onClick={() =>
                      runAction(() => resumeScheduledPost(post.id, userId))
                    }
                  >
                    <PlayCircle className="h-4 w-4 mr-2" />
                    Resume Post
                  </DropdownMenuItem>
                )}

                {canCancel && (
                  <DropdownMenuItem
                    className="text-yellow-500"
                    onClick={() => {
                      setCancelOpen(true);
                      setMenuOpen(false);
                    }}
                  >
                    <Clock className="h-4 w-4 mr-2" />
                    Cancel Post
                  </DropdownMenuItem>
                )}

                <DropdownMenuItem
                  className="text-red-500"
                  onClick={() => {
                    setDeleteOpen(true);
                    setMenuOpen(false);
                  }}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Permanently
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>

        {/* -------- Card body -------- */}
        <CardContent>
          <div className="flex gap-3 mb-3">
            <AvatarWithFallback
              src={avatarUrl}
              alt={`${accountName} avatar`}
              size={40} /* 40 px = h‑10 w‑10 */
              className="rounded-full" /* garde la forme circulaire */
            />
            <div>
              <div className="font-medium">{accountName}</div>
              <div className="text-xs text-muted-foreground capitalize">
                {post.platform} Account
              </div>
            </div>
          </div>

          {post.post_title && (
            <div className="line-clamp-3 text-sm">{post.post_title}</div>
          )}

          <div className="flex items-center text-xs text-muted-foreground mt-2">
            <CalendarIcon className="h-3 w-3 mr-1.5" />
            {formattedDate}
          </div>

          <div className="flex items-center gap-1.5 text-xs mt-1">
            <Badge variant="outline" className="capitalize">
              {post.media_type}
            </Badge>
          </div>

          {post.status === "failed" && post.error_message && (
            <div className="mt-4 text-xs text-red-500 flex items-start gap-1.5">
              <X className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{post.error_message}</span>
            </div>
          )}
        </CardContent>

        <CardFooter className="pt-0">
          {post.status === "scheduled" && (
            <div className="text-xs text-muted-foreground">
              Will be published automatically at the scheduled time.
            </div>
          )}
          {post.status === "cancelled" && (
            <div className="text-xs text-muted-foreground">
              This post was cancelled and will not be published.
            </div>
          )}
        </CardFooter>
      </Card>
    </>
  );
}
