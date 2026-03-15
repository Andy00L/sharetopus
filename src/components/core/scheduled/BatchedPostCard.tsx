// components/core/scheduled/BatchedPostCard.tsx
"use client";

import { format } from "date-fns";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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
import { Card, CardFooter, CardHeader } from "@/components/ui/card";

import {
  CalendarIcon,
  Check,
  Clock,
  PlayCircle,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";

import { cancelScheduledPostBatch } from "@/actions/server/scheduleActions/cancelScheduledPost";
import { deleteScheduledPostBatch } from "@/actions/server/scheduleActions/deleteScheduledPost";
import { resumeScheduledPostBatch } from "@/actions/server/scheduleActions/resumeScheduledPost";
import { updateScheduledTimeBatch } from "@/actions/server/scheduleActions/updateScheduledTime";
import SocialAvatarWrapper from "@/components/SocialAvatarWrapper";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScheduledPost } from "@/lib/types/dbTypes";
import PlatformContentDropdown from "./PlatformContentDropdown/PlatformContentDropdown";

interface BatchedPostCardProps {
  readonly posts: ScheduledPost[];
  readonly userId: string | null;
}

export default function BatchedPostCard({
  posts,
  userId,
}: BatchedPostCardProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

  // Use the first post for main display info
  const firstPost = posts[0];
  const scheduledDate = new Date(firstPost.scheduled_at);
  const formattedDate = format(scheduledDate, "MMM d, yyyy 'at' h:mm a");

  // Get unique status from all posts in the batch
  const statuses = [...new Set(posts.map((post) => post.status))];
  const status = statuses.length === 1 ? statuses[0] : "mixed";

  // Get media type
  const mediaType = firstPost.media_type;

  // Check permissions for actions
  const canCancel = posts.some((post) => post.status === "scheduled");
  const canResume = posts.some((post) => post.status === "cancelled");
  const canReschedule = canCancel || canResume;

  const [rescheduleDate, setRescheduleDate] = useState<string>(
    format(new Date(firstPost.scheduled_at), "yyyy-MM-dd")
  );
  const [rescheduleTime, setRescheduleTime] = useState<string>(
    format(new Date(firstPost.scheduled_at), "HH:mm")
  );
  // Generate status badge
  const getStatusBadge = () => {
    switch (status) {
      case "scheduled":
        return (
          <Badge
            variant="outline"
            className="gap-1 text-blue-500 border-blue-200"
          >
            <Clock className="h-3 w-3" />
            Scheduled
          </Badge>
        );
      case "processing":
        return (
          <Badge
            variant="outline"
            className="gap-1 text-yellow-500 border-yellow-200"
          >
            <Clock className="h-3 w-3 animate-spin" />
            Processing
          </Badge>
        );
      case "posted":
        return (
          <Badge
            variant="outline"
            className="gap-1 text-green-500 border-green-200"
          >
            <Check className="h-3 w-3" />
            Posted
          </Badge>
        );
      case "failed":
        return (
          <Badge
            variant="outline"
            className="gap-1 text-red-500 border-red-200"
          >
            <X className="h-3 w-3" />
            Failed
          </Badge>
        );
      case "cancelled":
        return (
          <Badge
            variant="outline"
            className="gap-1 text-gray-500 border-gray-200"
          >
            <X className="h-3 w-3" />
            Cancelled
          </Badge>
        );
      case "mixed":
        return (
          <Badge
            variant="outline"
            className="gap-1 text-purple-500 border-purple-200"
          >
            Mixed Status
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  // Actions
  const runAction = async (
    fn: () => Promise<{ success: boolean; message: string; resetIn?: number }>
  ) => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fn();
      if (res.success) {
        toast.success(res.message);
        router.refresh();
      } else if (res.resetIn) {
        // Special handling for rate limits
        toast.error(
          `${res.message} Please try again in ${res.resetIn} seconds.`
        );
      } else {
        toast.error(res.message);
      }
    } catch {
      toast.error(`Unexpected error`);
    } finally {
      setLoading(false);
    }
  };

  // Reschedule handler
  const handleRescheduleSubmit = async () => {
    if (!userId) {
      toast.error("You need to be signed in to reschedule posts.");
      return;
    }

    if (!rescheduleDate || !rescheduleTime) {
      toast.error("Please select both a date and a time.");
      return;
    }

    const scheduledDateTime = new Date(`${rescheduleDate}T${rescheduleTime}`);

    if (isNaN(scheduledDateTime.getTime())) {
      toast.error("The selected date/time is invalid. Please try again.");
      return;
    }

    const doReschedule = async () => {
      const postIds = posts.map((post) => post.id);
      const result = await updateScheduledTimeBatch(
        postIds,
        scheduledDateTime,
        userId
      );

      if (result.success) {
        // Close dialogs on success; runAction will show toast + refresh.
        setRescheduleOpen(false);
        setIsOpen(false);
        setCancelOpen(false);
        setDeleteOpen(false);

        return {
          success: true,
          message: result.message,
        };
      }

      return {
        success: false,
        message: result.message,
        resetIn: result.resetIn,
      };
    };

    await runAction(doReschedule);
  };
  // Cancel all posts in batch
  const cancelAllPosts = async () => {
    try {
      // Use the batch function instead of multiple API calls
      const scheduledPostIds = posts
        .filter((post) => post.status === "scheduled")
        .map((post) => post.id);

      if (scheduledPostIds.length === 0) {
        return {
          success: false,
          message: "No posts available to cancel.",
        };
      }

      const result = await cancelScheduledPostBatch(scheduledPostIds, userId);

      // Use the details to provide more specific messages
      if (result.success) {
        return {
          success: true,
          message: result.message,
        };
      } else if (result.resetIn) {
        return {
          success: false,
          message: `${result.message} Please try again in ${result.resetIn} seconds.`,
        };
      } else {
        return {
          success: false,
          message: result.message,
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `Unexpected error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  };

  // Delete all posts in batch
  const deleteAllPosts = async () => {
    try {
      // Instead of making multiple API calls, use the batch deletion function
      const postIds = posts.map((post) => post.id);

      // With our new batch function, we can delete all posts in one call
      const result = await deleteScheduledPostBatch(postIds, userId);

      // Return the result directly
      return {
        success: result.success,
        message: result.message,
        resetIn: result.resetIn,
      };
    } catch (error) {
      return {
        success: false,
        message: `Unexpected error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  };

  // Resume all posts in batch
  const resumeAllPosts = async () => {
    try {
      // Filter for posts that can be resumed
      const cancelledPostIds = posts
        .filter((post) => post.status === "cancelled")
        .map((post) => post.id);

      if (cancelledPostIds.length === 0) {
        return {
          success: false,
          message: "No posts available to resume.",
        };
      }

      const result = await resumeScheduledPostBatch(cancelledPostIds, userId);

      // Use the details to provide more specific messages
      if (result.success) {
        return {
          success: true,
          message: result.message,
        };
      } else if (result.resetIn) {
        return {
          success: false,
          message: result.message,
          resetIn: result.resetIn,
        };
      } else {
        return {
          success: false,
          message: result.message,
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `Unexpected error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  };
  useEffect(() => {
    if (!rescheduleOpen && !cancelOpen && !deleteOpen && !isOpen) {
      // Reset all dialog-related states
      setLoading(false);
      setIsOpen(false); // Explicitly ensure main dialog is closed
      setRescheduleOpen(false);
      setCancelOpen(false);
      setDeleteOpen(false);
    }
  }, [rescheduleOpen, cancelOpen, deleteOpen, isOpen]);

  return (
    <>
      {/* Main Card */}
      <Card
        className="overflow-hidden border shadow-sm h-full cursor-pointer transition-all duration-200 hover:shadow-md hover:bg-accent/50 "
        onClick={() => setIsOpen(true)}
      >
        <CardHeader>
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground font-medium">
              {formattedDate}
            </span>
            <div className="flex gap-2">
              {getStatusBadge()}
              <Badge variant="secondary" className="capitalize">
                {mediaType}
              </Badge>
            </div>
          </div>
        </CardHeader>

        {/*  <CardContent>
          Content preview based on media type 
          <div className="flex flex-col items-center justify-center p-2 h-32">
            <MediaPreview
              mediaPath={firstPost.media_storage_path}
              mediaType={mediaType}
              title={firstPost.post_title!}
              description={firstPost.post_description!}
              userId={userId!}
              size="small"
            />
          </div>
        </CardContent>*/}

        <CardFooter className="p-3 pt-0 mt-auto">
          {/* Show avatars for all social accounts */}
          <div className="flex gap-2 pt-3 pl-3 items-center overflow-x-auto  w-full">
            {posts.map((post) => (
              <SocialAvatarWrapper
                key={post.id}
                src={post.social_accounts?.avatar_url}
                alt={`${post.platform} Account`}
                platform={post.platform}
                className="h-8 w-8 flex-shrink-0"
                size={32}
              />
            ))}
          </div>
        </CardFooter>
      </Card>

      {/* Detail Dialog */}
      <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
        <AlertDialogContent className="sm:max-w-[450px] max-h-[80vh] flex flex-col">
          <AlertDialogHeader className="flex-shrink-0">
            <AlertDialogTitle className="mb-2">
              Scheduled Posts ({posts.length})
            </AlertDialogTitle>{" "}
            <AlertDialogDescription className="mb-4">
              Scheduled for {formattedDate}
            </AlertDialogDescription>
            <div className="flex flex-wrap gap-2 mt-2">
              {canReschedule && (
                <Button
                  size="sm"
                  variant="outline"
                  className=" cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // First close all dialogs
                    setIsOpen(false);
                    // Then open the reschedule dialog separately
                    setRescheduleOpen(true);
                    // Use longer delay for safety
                  }}
                >
                  <CalendarIcon className="h-4 w-4 mr-1 cursor-pointer" />
                  Reschedule
                </Button>
              )}
              {canCancel && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mr-2 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCancelOpen(true);
                    setIsOpen(false);
                  }}
                >
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
              )}
              {canResume && (
                <Button
                  size="sm"
                  className="cursor-pointer"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    runAction(resumeAllPosts);
                    setIsOpen(false);
                  }}
                >
                  <PlayCircle className="h-4 w-4 mr-1" />
                  Resume
                </Button>
              )}
            </div>
          </AlertDialogHeader>

          <div className="py-3 overflow-y-auto flex-grow">
            <h4 className="text-sm font-medium mb-2 ">Platforms</h4>
            <div className="flex flex-col gap-4">
              {posts.map((post) => (
                <PlatformContentDropdown key={post.id} post={post} />
              ))}
            </div>
          </div>

          <AlertDialogFooter className="flex justify-between flex-shrink-0">
            <Button
              variant="destructive"
              className="cursor-pointer"
              size="sm"
              onClick={() => {
                setDeleteOpen(true);
                setIsOpen(false);
              }}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Delete
            </Button>
            <AlertDialogCancel className="cursor-pointer">
              Close
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reschedule Dialog */}
      {rescheduleOpen && (
        <AlertDialog
          open={rescheduleOpen}
          onOpenChange={(open) => !open && setRescheduleOpen(false)}
        >
          <AlertDialogContent className="sm:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>
                Reschedule {posts.length} Posts
              </AlertDialogTitle>
              <AlertDialogDescription>
                Select a new date and time for these posts
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="date">Date</Label>
                <Input
                  id="date"
                  type="date"
                  value={rescheduleDate}
                  min={format(new Date(), "yyyy-MM-dd")}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="time">Time</Label>
                <Input
                  id="time"
                  type="time"
                  value={rescheduleTime}
                  onChange={(e) => setRescheduleTime(e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>

            <AlertDialogFooter>
              <Button
                variant="outline"
                className="cursor-pointer"
                onClick={() => setRescheduleOpen(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                onClick={handleRescheduleSubmit}
                className="cursor-pointer"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Updating...
                  </>
                ) : (
                  <>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    Reschedule Posts
                  </>
                )}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Cancel Dialog */}
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel All Scheduled Posts?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel all {posts.length} posts in this batch. The media
              will be preserved so you can reschedule later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">
              Keep Posts
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-yellow-500 hover:bg-yellow-600 cursor-pointer"
              onClick={() => runAction(cancelAllPosts)}
            >
              Cancel All Posts
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Dialog */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete All Posts Permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {posts.length} posts in this
              batch and their media.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">
              Keep Posts
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-600 cursor-pointer"
              onClick={() => runAction(deleteAllPosts)}
            >
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
