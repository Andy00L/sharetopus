"use client";

import { format } from "date-fns";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  CalendarIcon,
  PlayCircle,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";

import { cancelScheduledPostBatchAction } from "@/actions/server/scheduleActions/cancel/cancelScheduledPostBatchAction";
import { deleteScheduledPostBatchAction } from "@/actions/server/scheduleActions/delete/deleteScheduledPostBatchAction";
import { updateScheduledTimeBatchAction } from "@/actions/server/scheduleActions/reschedule/updateScheduledTimeBatchAction";
import { resumeScheduledPostBatchAction } from "@/actions/server/scheduleActions/resume/resumeScheduledPostBatchAction";
import { ScheduledPostListItem } from "@/lib/types/dbTypes";
import PlatformContentDropdown from "./PlatformContentDropdown/PlatformContentDropdown";

interface BatchDetailDialogProps {
  readonly posts: ScheduledPostListItem[];
  readonly userId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export default function BatchDetailDialog({
  posts,
  userId,
  open,
  onOpenChange,
}: BatchDetailDialogProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

  const firstPost = posts[0];
  const scheduledDate = new Date(firstPost.scheduled_at);
  const formattedDate = format(scheduledDate, "MMM d, yyyy 'at' h:mm a");

  const canCancel = posts.some((post) => post.status === "scheduled");
  const canResume = posts.some((post) => post.status === "cancelled");
  const canReschedule = canCancel || canResume;

  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");

  function openRescheduleForm() {
    setRescheduleDate(format(scheduledDate, "yyyy-MM-dd"));
    setRescheduleTime(format(scheduledDate, "HH:mm"));
    setRescheduleOpen(true);
  }

  function handleMainOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setLoading(false);
      setRescheduleOpen(false);
    }
    onOpenChange(nextOpen);
  }

  const runAction = async (
    fn: () => Promise<{ success: boolean; message: string; resetIn?: number }>,
  ) => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fn();
      if (res.success) {
        toast.success(res.message);
        router.refresh();
      } else if (res.resetIn) {
        toast.error(
          `${res.message} Please try again in ${res.resetIn} seconds.`,
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
      const result = await updateScheduledTimeBatchAction(
        postIds,
        scheduledDateTime,
        userId,
      );

      if (result.success) {
        setRescheduleOpen(false);
        onOpenChange(false);

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

  const cancelAllPosts = async () => {
    try {
      const scheduledPostIds = posts
        .filter((post) => post.status === "scheduled")
        .map((post) => post.id);

      if (scheduledPostIds.length === 0) {
        return {
          success: false,
          message: "No posts available to cancel.",
        };
      }

      const result = await cancelScheduledPostBatchAction(
        scheduledPostIds,
        userId,
      );

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

  const deleteAllPosts = async () => {
    try {
      const postIds = posts.map((post) => post.id);
      const result = await deleteScheduledPostBatchAction(postIds, userId);

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

  const resumeAllPosts = async () => {
    try {
      const cancelledPostIds = posts
        .filter((post) => post.status === "cancelled")
        .map((post) => post.id);

      if (cancelledPostIds.length === 0) {
        return {
          success: false,
          message: "No posts available to resume.",
        };
      }

      const result = await resumeScheduledPostBatchAction(
        cancelledPostIds,
        userId,
      );

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

  return (
    <>
      <AlertDialog open={open} onOpenChange={handleMainOpenChange}>
        <AlertDialogContent className="sm:max-w-[450px] max-h-[80vh] flex flex-col">
          <AlertDialogHeader className="flex-shrink-0">
            <AlertDialogTitle className="mb-2">
              {rescheduleOpen
                ? `Reschedule ${posts.length} Posts`
                : `Scheduled Posts (${posts.length})`}
            </AlertDialogTitle>{" "}
            <AlertDialogDescription className="mb-4">
              {rescheduleOpen
                ? "Select a new date and time for these posts"
                : `Scheduled for ${formattedDate}`}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {rescheduleOpen ? (
            <>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="date">Date</Label>
                  <Input
                    id="date"
                    type="date"
                    value={rescheduleDate}
                    min={format(new Date(), "yyyy-MM-dd")}
                    onChange={(event) => setRescheduleDate(event.target.value)}
                    disabled={loading}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="time">Time</Label>
                  <Input
                    id="time"
                    type="time"
                    value={rescheduleTime}
                    onChange={(event) => setRescheduleTime(event.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>

              <AlertDialogFooter className="flex-shrink-0">
                <Button
                  variant="outline"
                  className="cursor-pointer"
                  aria-label="Cancel reschedule"
                  onClick={() => setRescheduleOpen(false)}
                  disabled={loading}
                >
                  Back
                </Button>
                <Button
                  onClick={handleRescheduleSubmit}
                  className="cursor-pointer"
                  aria-label="Reschedule Posts"
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
            </>
          ) : (
            <>
              <div className="py-3 overflow-y-auto flex-grow">
                <h4 className="text-sm font-medium mb-2 ">Platforms</h4>
                <div className="flex flex-col gap-4">
                  {posts.map((post) => (
                    <PlatformContentDropdown key={post.id} post={post} />
                  ))}
                </div>
              </div>

              <AlertDialogFooter className="flex flex-wrap justify-between gap-2 flex-shrink-0">
                <div className="flex flex-wrap gap-2">
                  {canReschedule && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="cursor-pointer"
                      aria-label="Reschedule"
                      onClick={openRescheduleForm}
                    >
                      <CalendarIcon className="h-4 w-4 mr-1" />
                      Reschedule
                    </Button>
                  )}
                  {canCancel && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="cursor-pointer"
                      aria-label="Cancel scheduled posts"
                      onClick={() => {
                        setCancelOpen(true);
                        handleMainOpenChange(false);
                      }}
                    >
                      <X className="h-4 w-4 mr-1" />
                      Cancel
                    </Button>
                  )}
                  {canResume && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="cursor-pointer"
                      aria-label="Resume scheduled posts"
                      onClick={() => {
                        runAction(resumeAllPosts);
                        handleMainOpenChange(false);
                      }}
                    >
                      <PlayCircle className="h-4 w-4 mr-1" />
                      Resume
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    className="cursor-pointer"
                    aria-label="Delete scheduled posts"
                    size="sm"
                    onClick={() => {
                      setDeleteOpen(true);
                      handleMainOpenChange(false);
                    }}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete
                  </Button>
                </div>
                <AlertDialogCancel className="cursor-pointer">
                  Close
                </AlertDialogCancel>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

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
