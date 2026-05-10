"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { TikTokOptions } from "@/lib/types/dbTypes";
import { format } from "date-fns";
import {
  CalendarIcon,
  Clock,
  Loader2,
  SendHorizontal,
} from "lucide-react";
import FilePreview from "../../../../renderFilePreview";

interface SchedulingPanelProps {
  readonly selectedFile: File | null;
  readonly previewUrl: string | null;
  readonly postType: "text" | "image" | "video";
  readonly isScheduled: boolean;
  readonly setIsScheduled: (v: boolean) => void;
  readonly scheduledDate: string;
  readonly setScheduledDate: (v: string) => void;
  readonly scheduledTime: string;
  readonly setScheduledTime: (v: string) => void;
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly uploadProgress: number;
  readonly onSubmit: () => void;
  readonly disabled: boolean;
  readonly tiktokComplianceEnabled: boolean;
  readonly hasTikTokAccounts: boolean;
  readonly tikTokOptions?: TikTokOptions;
}

export default function SchedulingPanel({
  selectedFile,
  previewUrl,
  postType,
  isScheduled,
  setIsScheduled,
  scheduledDate,
  setScheduledDate,
  scheduledTime,
  setScheduledTime,
  error,
  isLoading,
  uploadProgress,
  onSubmit,
  disabled,
  tiktokComplianceEnabled,
  hasTikTokAccounts,
  tikTokOptions,
}: SchedulingPanelProps) {
  // TikTok declaration text (compliance mode only)
  const showTikTokDeclaration =
    tiktokComplianceEnabled && hasTikTokAccounts;
  const showBrandedPolicyLink =
    tikTokOptions?.brandContentToggle === true &&
    tikTokOptions?.brandedContent === true;
  return (
    <>
      {/* Preview panel */}
      {selectedFile && (
        <div className="border rounded-2xl  bg-white ">
          <div className="p-5">
            <h1 className="mb-3">Media Preview</h1>
            <div className="rounded-lg overflow-hidden bg-white relative">
              <FilePreview
                selectedFile={selectedFile}
                mediaType={postType}
                previewUrl={previewUrl}
              />
            </div>
          </div>
        </div>
      )}

      {/**Scheduling button */}
      <div className=" p-2.5 border rounded-2xl  bg-white">
        {/* Scheduling toggle */}
        <div className="flex items-center  space-x-2 py-2">
          <Switch
            id="schedule-toggle"
            checked={isScheduled}
            onCheckedChange={setIsScheduled}
          />
          <Label htmlFor="schedule-toggle">Schedule for later</Label>
        </div>

        {/* Scheduling options */}
        {isScheduled && (
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="schedule-date">Date</Label>
                <Input
                  id="schedule-date"
                  type="date"
                  value={scheduledDate}
                  min={format(new Date(), "yyyy-MM-dd")}
                  onChange={(e) => setScheduledDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="schedule-time">Time</Label>
                <Input
                  id="schedule-time"
                  type="time"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                />
              </div>
            </div>
            <div className="text-sm text-muted-foreground flex items-center">
              <Clock className="mr-2 h-4 w-4" />
              Will be posted on{" "}
              {format(
                new Date(`${scheduledDate}T${scheduledTime}`),
                "PPP 'at' p"
              )}
            </div>
          </div>
        )}

        {/* Error display */}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {selectedFile && isLoading && (
          <div className="mt-2">
            <p className="text-sm text-muted-foreground mb-1">
              Uploading: {uploadProgress}%
            </p>
            <div className="w-full bg-muted rounded-full h-2.5">
              <div
                className="bg-primary h-2.5 rounded-full"
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
          </div>
        )}

        {/* TikTok declaration text */}
        {showTikTokDeclaration && (
          <p className="text-xs text-muted-foreground pt-2">
            By posting, you agree to TikTok&apos;s{" "}
            {showBrandedPolicyLink && (
              <>
                <a
                  href="https://www.tiktok.com/legal/page/global/bc-policy/en"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  Branded Content Policy
                </a>
                {" and "}
              </>
            )}
            <a
              href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              Music Usage Confirmation
            </a>
          </p>
        )}

        {!isLoading && (
          <div className="pt-4 flex justify-between">
            <Button
              onClick={onSubmit}
              disabled={isLoading || disabled}
              className="w-full"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isScheduled ? "Scheduling..." : "Publishing..."}
                </>
              ) : (
                <>
                  {isScheduled ? (
                    <>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      Schedule Post
                    </>
                  ) : (
                    <>
                      <SendHorizontal className="mr-2 h-4 w-4" />
                      Publish Now
                    </>
                  )}
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
