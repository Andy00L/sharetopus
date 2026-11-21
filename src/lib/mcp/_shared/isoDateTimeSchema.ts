import { z } from "zod";

const ISO_DATE_TIME_WITH_ZONE = z.iso.datetime({ offset: true });

// zod's JSON Schema for z.iso.datetime carries a long pattern; a refine keeps it out of the tool's input schema.
export const IsoDateTimeSchema = z
  .string()
  .refine((value) => ISO_DATE_TIME_WITH_ZONE.safeParse(value).success, {
    message: "Expected ISO 8601 with a zone, e.g. 2026-10-08T10:00:00Z",
  });
