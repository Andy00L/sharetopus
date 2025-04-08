"use client";

import {
  cancelScheduledPost,
  deleteScheduledPost,
  resumeScheduledPost,
  updateScheduledTime,
} from "@/actions/server/supabase/scheduleActions";
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

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarContent, SidebarGroup } from "@/components/ui/sidebar";
import {
  AlertCircle,
  CalendarIcon,
  Check,
  Clock,
  MoreVertical,
  PlayCircle,
  PlusCircle,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import Link from "next/link";

// Type for scheduled post with joined account data
interface ScheduledPost {
  id: string;
  platform: string;
  status: "scheduled" | "processing" | "posted" | "failed" | "cancelled";
  scheduled_at: string;
  posted_at: string | null;
  post_title: string | null;
  post_options: Record<string, unknown> | null; // Replace 'any' with Record
  media_type: string;
  media_storage_path: string;
  error_message: string | null;
  created_at: string;
  social_accounts: {
    id: string;
    platform: string;
    account_identifier: string;
    extra: {
      profile?: {
        display_name?: string;
        username?: string;
        avatar_url?: string;
      };
    } | null;
  };
}

interface ScheduledPostsListProps {
  readonly posts: ScheduledPost[];
  readonly userId: string | null;
}

// Separate RescheduleDialog component
function RescheduleDialog({
  post,
  isOpen,
  onClose,
  userId,
  onSuccess,
}: {
  post: ScheduledPost | null;
  isOpen: boolean;
  onClose: () => void;
  userId: string | null;
  onSuccess: () => void;
}) {
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

export default function ScheduledPostsList({
  posts,
  userId,
}: ScheduledPostsListProps) {
  const router = useRouter();
  const [loadingPostId, setLoadingPostId] = useState<string | null>(null);
  const [showCancelDialog, setShowCancelDialog] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState<string | null>(null);
  const [postToReschedule, setPostToReschedule] =
    useState<ScheduledPost | null>(null);

  // Track which dropdown is open
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  // Handle post cancellation
  const handleCancelPost = async (postId: string) => {
    try {
      setLoadingPostId(postId);
      const result = await cancelScheduledPost(postId, userId);

      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "An unexpected error occurred";
      toast.error(`Failed to cancel post: ${errorMessage}`);
    } finally {
      setLoadingPostId(null);
      setShowCancelDialog(null);
      setOpenDropdownId(null); // Reset dropdown state
    }
  };

  // Handle post deletion
  const handleDeletePost = async (postId: string) => {
    try {
      setLoadingPostId(postId);
      const result = await deleteScheduledPost(postId, userId);

      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "An unexpected error occurred";
      toast.error(`Failed to delete post: ${errorMessage}`);
    } finally {
      setLoadingPostId(null);
      setShowDeleteDialog(null);
      setOpenDropdownId(null); // Reset dropdown state
    }
  };

  // Handle resuming a cancelled post
  const handleResumePost = async (postId: string) => {
    try {
      setLoadingPostId(postId);
      const result = await resumeScheduledPost(postId, userId);

      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "An unexpected error occurred";
      toast.error(`Failed to resume post: ${errorMessage}`);
    } finally {
      setLoadingPostId(null);
      setOpenDropdownId(null); // Reset dropdown state
    }
  };

  // Content to show when no posts exist
  const emptyContent = (
    <div className="text-center p-8">
      <Clock className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="text-lg font-medium mb-2">No scheduled posts</h3>
      <p className="text-muted-foreground mb-4">
        You haven&apos;t scheduled any posts yet. When you do, they&apos;ll
        appear here.
      </p>
      <Button onClick={() => router.push("/schedule")}>Schedule a Post</Button>
    </div>
  );

  // All dialogs should close the dropdown when opened
  const openCancelDialog = (postId: string) => {
    setShowCancelDialog(postId);
    setOpenDropdownId(null);
  };

  const openDeleteDialog = (postId: string) => {
    setShowDeleteDialog(postId);
    setOpenDropdownId(null);
  };

  const openRescheduleDialog = (post: ScheduledPost) => {
    setPostToReschedule(post);
    setOpenDropdownId(null);
  };

  // Properly structured posts content using Sidebar components
  return (
    <>
      {/* Dialogs remain outside the sidebar structure */}
      <AlertDialog
        open={showCancelDialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setShowCancelDialog(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Scheduled Post?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel this scheduled post. The media will be preserved
              in case you want to reschedule it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowCancelDialog(null)}>
              Keep Post
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                showCancelDialog && handleCancelPost(showCancelDialog)
              }
              className="bg-yellow-500 hover:bg-yellow-600"
            >
              Cancel Post
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={showDeleteDialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setShowDeleteDialog(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Post Permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this post and its media files. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowDeleteDialog(null)}>
              Keep Post
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                showDeleteDialog && handleDeletePost(showDeleteDialog)
              }
              className="bg-red-500 hover:bg-red-600"
            >
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RescheduleDialog
        post={postToReschedule}
        isOpen={postToReschedule !== null}
        onClose={() => {
          setPostToReschedule(null);
        }}
        userId={userId}
        onSuccess={() => {
          router.refresh();
        }}
      />

      {/* Content structured for sidebar */}
      <SidebarContent>
        <div className="container px-4 py-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold">Scheduled Posts</h1>
              <p className="text-muted-foreground">
                Manage your scheduled posts for all your social platforms
              </p>
            </div>
            <Button asChild>
              <Link href="/schedule">
                <PlusCircle className="w-4 h-4 mr-2" />
                Schedule New Post
              </Link>
            </Button>
          </div>

          <SidebarGroup>
            {posts.length === 0 ? (
              emptyContent
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {posts.map((post) => {
                  // Format scheduled date
                  const scheduledDate = new Date(post.scheduled_at);
                  const formattedDate = new Intl.DateTimeFormat("en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(scheduledDate);

                  // Extract account info
                  const accountName =
                    post.social_accounts?.extra?.profile?.display_name ??
                    post.social_accounts?.extra?.profile?.username ??
                    post.social_accounts?.account_identifier.substring(0, 8) ??
                    "Unknown Account";

                  const avatarUrl =
                    post.social_accounts?.extra?.profile?.avatar_url ?? "";

                  // Get avatar fallback text (first letter of platform + account name)
                  const fallbackText = `${post.platform
                    .charAt(0)
                    .toUpperCase()}${accountName.charAt(0).toUpperCase()}`;

                  // Determine status badge color
                  let statusBadge;
                  switch (post.status) {
                    case "scheduled":
                      statusBadge = (
                        <Badge
                          variant="outline"
                          className="gap-1 text-blue-500 border-blue-200"
                        >
                          <Clock className="h-3 w-3" />
                          Scheduled
                        </Badge>
                      );
                      break;
                    case "processing":
                      statusBadge = (
                        <Badge
                          variant="outline"
                          className="gap-1 text-yellow-500 border-yellow-200"
                        >
                          <Clock className="h-3 w-3 animate-spin" />
                          Processing
                        </Badge>
                      );
                      break;
                    case "posted":
                      statusBadge = (
                        <Badge
                          variant="outline"
                          className="gap-1 text-green-500 border-green-200"
                        >
                          <Check className="h-3 w-3" />
                          Posted
                        </Badge>
                      );
                      break;
                    case "failed":
                      statusBadge = (
                        <Badge
                          variant="outline"
                          className="gap-1 text-red-500 border-red-200"
                        >
                          <X className="h-3 w-3" />
                          Failed
                        </Badge>
                      );
                      break;
                    case "cancelled":
                      statusBadge = (
                        <Badge
                          variant="outline"
                          className="gap-1 text-gray-500 border-gray-200"
                        >
                          <X className="h-3 w-3" />
                          Cancelled
                        </Badge>
                      );
                      break;
                    default:
                      statusBadge = (
                        <Badge variant="outline">{post.status}</Badge>
                      );
                  }

                  // Platform badge
                  const platformBadge = (
                    <Badge variant="secondary" className="capitalize">
                      {post.platform}
                    </Badge>
                  );

                  // Determine which actions are available based on post status
                  const canCancel = post.status === "scheduled";
                  const canResume = post.status === "cancelled";
                  const canReschedule =
                    post.status === "scheduled" || post.status === "cancelled";
                  const canDelete = true; // All posts can be deleted

                  return (
                    <Card key={post.id} className="relative">
                      {/* Loading overlay */}
                      {loadingPostId === post.id && (
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

                          {/* Show actions menu for all posts */}
                          <DropdownMenu
                            open={openDropdownId === post.id}
                            onOpenChange={(open) => {
                              if (open) {
                                setOpenDropdownId(post.id);
                              } else {
                                setOpenDropdownId(null);
                              }
                            }}
                          >
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                              >
                                <MoreVertical className="h-4 w-4" />
                                <span className="sr-only">Actions</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {/* Reschedule option for scheduled and cancelled posts */}
                              {canReschedule && (
                                <DropdownMenuItem
                                  className="text-blue-500 focus:text-blue-500"
                                  onClick={() => openRescheduleDialog(post)}
                                >
                                  <CalendarIcon className="h-4 w-4 mr-2" />
                                  Reschedule
                                </DropdownMenuItem>
                              )}

                              {/* Resume option only for cancelled posts */}
                              {canResume && (
                                <DropdownMenuItem
                                  className="text-green-500 focus:text-green-500"
                                  onClick={() => handleResumePost(post.id)}
                                >
                                  <PlayCircle className="h-4 w-4 mr-2" />
                                  Resume Post
                                </DropdownMenuItem>
                              )}

                              {/* Cancel option only for scheduled posts */}
                              {canCancel && (
                                <DropdownMenuItem
                                  className="text-yellow-500 focus:text-yellow-500"
                                  onClick={() => openCancelDialog(post.id)}
                                >
                                  <Clock className="h-4 w-4 mr-2" />
                                  Cancel Post
                                </DropdownMenuItem>
                              )}

                              {/* Delete option for all posts */}
                              {canDelete && (
                                <DropdownMenuItem
                                  className="text-red-500 focus:text-red-500"
                                  onClick={() => openDeleteDialog(post.id)}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Delete Permanently
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </CardHeader>

                      <CardContent>
                        <div className="flex gap-3 mb-3">
                          <Avatar className="h-10 w-10">
                            {avatarUrl && <AvatarImage src={avatarUrl} />}
                            <AvatarFallback>{fallbackText}</AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium">{accountName}</div>
                            <div className="text-xs text-muted-foreground capitalize">
                              {post.platform} Account
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          {post.post_title && (
                            <div className="line-clamp-3 text-sm">
                              {post.post_title}
                            </div>
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
                        </div>

                        {/* Show error message if post failed */}
                        {post.status === "failed" && post.error_message && (
                          <div className="mt-4 text-xs text-red-500 flex items-start gap-1.5">
                            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span>{post.error_message}</span>
                          </div>
                        )}
                      </CardContent>

                      <CardFooter className="pt-0">
                        {post.status === "scheduled" && (
                          <div className="text-xs text-muted-foreground">
                            Will be published automatically at the scheduled
                            time.
                          </div>
                        )}
                        {post.status === "cancelled" && (
                          <div className="text-xs text-muted-foreground">
                            This post was cancelled and will not be published.
                          </div>
                        )}
                      </CardFooter>
                    </Card>
                  );
                })}
              </div>
            )}
          </SidebarGroup>
        </div>
      </SidebarContent>
    </>
  );
}
