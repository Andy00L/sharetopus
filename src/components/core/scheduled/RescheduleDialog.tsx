// components/core/scheduled/RescheduleDialog.tsx
import { updateScheduledTimeBatch } from "@/actions/server/scheduleActions/updateScheduledTime";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScheduledPost } from "@/lib/types/dbTypes";
import { format } from "date-fns";
import { CalendarIcon, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface RescheduleDialogProps {
  readonly post: ScheduledPost | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly userId: string | null;
  readonly onSuccess: () => void;
  readonly batchMode?: boolean;
  readonly postIds?: string[];
}

export default function RescheduleDialog({
  post,
  isOpen,
  onClose,
  userId,
  onSuccess,
  batchMode = true,
  postIds = [],
}: RescheduleDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const initialDate = post
    ? new Date(post.scheduled_at)
    : new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

  const [newDate, setNewDate] = useState<Date | null>(initialDate);

  const [dateInputValue, setDateInputValue] = useState(
    format(initialDate, "yyyy-MM-dd")
  );
  const [timeInputValue, setTimeInputValue] = useState(
    format(initialDate, "HH:mm")
  );

  // Determine which post IDs to update
  const getPostIdsToUpdate = () => {
    // Use postIds from props if in batch mode and available
    if (batchMode && postIds.length > 0) {
      return postIds;
    }
    // Otherwise, use the single post ID if available
    if (post?.id) {
      return [post.id];
    }
    // If neither is available, return empty array
    return [];
  };

  const handleSubmit = async () => {
    if (!newDate || !userId) {
      toast.error("Missing information for rescheduling");
      return;
    }
    const idsToUpdate = getPostIdsToUpdate();
    if (idsToUpdate.length === 0) {
      toast.error("No posts selected for rescheduling");
      return;
    }
    try {
      setIsLoading(true);

      // Always use the batch function for both single and multiple posts
      const result = await updateScheduledTimeBatch(
        idsToUpdate,
        newDate,
        userId
      );

      if (result.success) {
        // Use the server's message for more detailed feedback

        toast.success(result.message);
        onSuccess();
        onClose();
      } else {
        // Handle rate limiting specifically
        if (result.resetIn) {
          toast.error(
            `${result.message} Please try again in ${result.resetIn} seconds.`
          );
        } else {
          toast.error(result.message);
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "An unexpected error occurred";
      toast.error(`Failed to reschedule post: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Update newDate when inputs change
  const updateDateFromInputs = (
    dateStr: string = dateInputValue,
    timeStr: string = timeInputValue
  ) => {
    if (!dateStr) return;

    try {
      const [year, month, day] = dateStr.split("-").map(Number);
      const [hours, minutes] = timeStr
        ? timeStr.split(":").map(Number)
        : [0, 0];

      const date = new Date(year, month - 1, day, hours, minutes);
      if (!isNaN(date.getTime())) {
        setNewDate(date);
      }
    } catch (e) {
      console.error("Date parsing error:", e);
    }
  };
  // Get the actual number of posts to update
  const postsCount = getPostIdsToUpdate().length;
  const isSinglePost = postsCount === 1;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isSinglePost
              ? "Reschedule Post"
              : "Reschedule ${postsCount} Posts"}
          </DialogTitle>
          <DialogDescription>
            {isSinglePost
              ? "Select a new date and time for this post to be published."
              : `Select a new date and time for all ${postsCount} posts in this batch.`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              type="date"
              value={dateInputValue}
              min={format(new Date(), "yyyy-MM-dd")}
              onChange={(e) => {
                setDateInputValue(e.target.value);
                updateDateFromInputs(e.target.value);
              }}
              disabled={isLoading}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="time">Time</Label>
            <Input
              id="time"
              type="time"
              value={timeInputValue}
              onChange={(e) => {
                setTimeInputValue(e.target.value);
                updateDateFromInputs(undefined, e.target.value);
              }}
              disabled={isLoading}
            />
          </div>

          {newDate && (
            <div className="text-sm text-muted-foreground">
              {isSinglePost ? "Post" : "Posts"} will be published on:{" "}
              <span className="font-medium">
                {format(newDate, "PPP 'at' p")}
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isLoading || !newDate || postsCount === 0}
          >
            {isLoading ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Updating...
              </>
            ) : (
              <>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {isSinglePost
                  ? "Update Schedule"
                  : `Reschedule ${postsCount} Posts`}{" "}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
