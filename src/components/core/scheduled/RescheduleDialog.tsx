import { updateScheduledTime } from "@/actions/server/scheduleActions/updateScheduledTime";
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
import { RefreshCw, CalendarIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface RescheduleDialogProps {
  readonly post: ScheduledPost | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly userId: string | null;
  readonly onSuccess: () => void;
}
export default function RescheduleDialog({
  post,
  isOpen,
  onClose,
  userId,
  onSuccess,
}: RescheduleDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [newDate, setNewDate] = useState<Date | null>(
    post ? new Date(post.scheduled_at) : null
  );
  const [dateInputValue, setDateInputValue] = useState(
    post ? format(new Date(post.scheduled_at), "yyyy-MM-dd") : ""
  );
  const [timeInputValue, setTimeInputValue] = useState(
    post ? format(new Date(post.scheduled_at), "HH:mm") : ""
  );

  const handleSubmit = async () => {
    if (!post || !newDate || !userId) {
      toast.error("Missing information for rescheduling");
      return;
    }

    try {
      setIsLoading(true);
      const result = await updateScheduledTime(post.id, newDate, userId);

      if (result.success) {
        toast.success(result.message);
        onSuccess();
        onClose();
      } else {
        toast.error(result.message);
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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reschedule Post</DialogTitle>
          <DialogDescription>
            Select a new date and time for this post to be published.
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
              Post will be published on:{" "}
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
          <Button onClick={handleSubmit} disabled={isLoading || !newDate}>
            {isLoading ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Updating...
              </>
            ) : (
              <>
                <CalendarIcon className="mr-2 h-4 w-4" />
                Update Schedule
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
