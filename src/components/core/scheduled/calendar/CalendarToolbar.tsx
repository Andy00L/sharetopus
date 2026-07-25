"use client";

import { addDays, format, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight, ListFilter, Rows3 } from "lucide-react";
import Link from "next/link";

import {
  getPlatformBrandIcon,
  PlatformLetterBadge,
} from "@/components/icons/platformBrandIcons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getPlatformDisplayLabel } from "@/lib/platforms/capabilities";
import { POST_STATUS_STYLES } from "../statusStyles";
import { WEEK_STARTS_ON, type CalendarView } from "./calendarMath";

/** Legend statuses, in lifecycle order. "queued"/"mixed" stay dialog-only. */
const LEGEND_STATUSES = [
  "scheduled",
  "processing",
  "posted",
  "failed",
  "cancelled",
] as const;

interface CalendarToolbarProps {
  readonly view: CalendarView;
  readonly anchor: Date;
  /** Every platform present in the loaded posts, in first-seen order. */
  readonly availablePlatforms: readonly string[];
  /** Null means no filter (all platforms shown). */
  readonly selectedPlatforms: ReadonlySet<string> | null;
  readonly onViewChange: (view: CalendarView) => void;
  readonly onNavigate: (direction: "previous" | "today" | "next") => void;
  readonly onTogglePlatform: (platform: string) => void;
  readonly onClearPlatformFilter: () => void;
}

function formatRangeLabel(view: CalendarView, anchor: Date): string {
  if (view === "month") {
    return format(anchor, "MMMM yyyy");
  }
  const weekStart = startOfWeek(anchor, { weekStartsOn: WEEK_STARTS_ON });
  const weekEnd = addDays(weekStart, 6);
  return `${format(weekStart, "MMM d")} - ${format(weekEnd, "MMM d, yyyy")}`;
}

/**
 * The calendar's control row: range navigation, month/week toggle, the
 * link back to the list view, a platform filter, and the status legend.
 */
export default function CalendarToolbar({
  view,
  anchor,
  availablePlatforms,
  selectedPlatforms,
  onViewChange,
  onNavigate,
  onTogglePlatform,
  onClearPlatformFilter,
}: CalendarToolbarProps) {
  const selectedCount = selectedPlatforms?.size ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 cursor-pointer p-0"
            aria-label={`Previous ${view}`}
            onClick={() => onNavigate("previous")}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 cursor-pointer px-2.5"
            onClick={() => onNavigate("today")}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 cursor-pointer p-0"
            aria-label={`Next ${view}`}
            onClick={() => onNavigate("next")}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <h2 className="min-w-40 text-base font-semibold tracking-tight">
          {formatRangeLabel(view, anchor)}
        </h2>

        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 cursor-pointer gap-1.5"
              >
                <ListFilter className="h-3.5 w-3.5" />
                Platforms
                {selectedCount > 0 && (
                  <span className="rounded-full bg-primary px-1.5 font-mono text-[10px] text-primary-foreground">
                    {selectedCount}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>Filter by platform</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {availablePlatforms.map((platform) => {
                const PlatformIcon = getPlatformBrandIcon(platform);
                return (
                  <DropdownMenuCheckboxItem
                    key={platform}
                    checked={
                      selectedPlatforms === null ||
                      selectedPlatforms.has(platform)
                    }
                    onCheckedChange={() => onTogglePlatform(platform)}
                  >
                    <span className="mr-2 inline-flex w-3 justify-center text-muted-foreground">
                      {PlatformIcon ? (
                        <PlatformIcon />
                      ) : (
                        <PlatformLetterBadge platform={platform} />
                      )}
                    </span>
                    {getPlatformDisplayLabel(platform)}
                  </DropdownMenuCheckboxItem>
                );
              })}
              {selectedPlatforms !== null && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onClearPlatformFilter}>
                    Show all platforms
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="inline-flex rounded-lg border bg-card p-0.5">
            <button
              type="button"
              onClick={() => onViewChange("month")}
              className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150 ${
                view === "month"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              Month
            </button>
            <button
              type="button"
              onClick={() => onViewChange("week")}
              className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150 ${
                view === "week"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              Week
            </button>
            <Link
              href="/scheduled?view=list"
              className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
            >
              <Rows3 className="h-3 w-3" />
              List
            </Link>
          </div>
        </div>
      </div>

      <div className="hidden items-center gap-3 md:flex">
        {LEGEND_STATUSES.map((status) => {
          const statusStyle = POST_STATUS_STYLES[status];
          return (
            <span
              key={status}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${statusStyle.dotClass}`}
                aria-hidden="true"
              />
              {statusStyle.label}
            </span>
          );
        })}
        <span className="ml-auto text-[11px] text-muted-foreground">
          Drag a post to reschedule it. Click a day&apos;s + to schedule there.
        </span>
      </div>
    </div>
  );
}
