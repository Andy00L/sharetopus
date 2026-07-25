// components/suspense/scheduled/ScheduleCalendarSkeleton.tsx

/** Cells in the pulsing placeholder grid: 7 columns x 5 rows. */
const SKELETON_CELL_COUNT = 35;

/**
 * Loading placeholder mirroring the calendar layout (toolbar row + month
 * grid) so the resolve causes no layout shift.
 */
export default function ScheduleCalendarSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="h-8 w-28 rounded-lg bg-muted" />
        <div className="h-6 w-40 rounded-md bg-muted" />
        <div className="ml-auto h-8 w-56 rounded-lg bg-muted" />
      </div>
      <div className="overflow-hidden rounded-xl border">
        <div className="grid grid-cols-7 gap-px bg-border">
          {Array.from({ length: SKELETON_CELL_COUNT }, (_, cellIndex) => (
            <div key={cellIndex} className="min-h-28 bg-card p-1.5">
              <div className="h-5 w-5 rounded-full bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
