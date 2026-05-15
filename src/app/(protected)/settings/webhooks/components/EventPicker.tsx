"use client";

/**
 * Checkbox list for selecting webhook event types.
 */
export function EventPicker({
  allEvents,
  selectedEvents,
  onChange,
}: {
  allEvents: string[];
  selectedEvents: string[];
  onChange: (events: string[]) => void;
}) {
  const handleToggleEvent = (eventName: string) => {
    if (selectedEvents.includes(eventName)) {
      onChange(selectedEvents.filter((selectedEvent) => selectedEvent !== eventName));
    } else {
      onChange([...selectedEvents, eventName]);
    }
  };

  return (
    <div>
      <label className="text-sm font-medium block mb-2">Events</label>
      <div className="space-y-2">
        {allEvents.map((eventName) => (
          <label
            key={eventName}
            className="flex items-center gap-2 text-sm cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selectedEvents.includes(eventName)}
              onChange={() => handleToggleEvent(eventName)}
              className="rounded border-input"
            />
            <code className="text-xs">{eventName}</code>
          </label>
        ))}
      </div>
    </div>
  );
}
