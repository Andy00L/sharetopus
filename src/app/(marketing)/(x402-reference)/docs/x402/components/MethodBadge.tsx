import { cn } from "@/lib/utils";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

// Per-method badge colors from the design contract. The x402 surface uses
// only GET and POST today; PATCH and DELETE are wired so the component needs
// no edits when the surface grows.
const METHOD_CLASSES: Record<HttpMethod, string> = {
  GET: "bg-emerald-100 text-emerald-700 border-emerald-200",
  POST: "bg-blue-100 text-blue-700 border-blue-200",
  PATCH: "bg-amber-100 text-amber-700 border-amber-200",
  DELETE: "bg-red-100 text-red-700 border-red-200",
};

export function MethodBadge({ method }: { method: HttpMethod }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border",
        METHOD_CLASSES[method]
      )}
    >
      {method}
    </span>
  );
}
