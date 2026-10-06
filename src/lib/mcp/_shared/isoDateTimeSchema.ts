import { z } from "zod";

const ISO_DATE_TIME_WITH_ZONE = z.iso.datetime({ offset: true });

/**
 * An ISO 8601 time with a zone (Z or +02:00). Checked with a refine instead of
 * z.iso.datetime so the tool's JSON Schema skips the 400-character regex.
 */
export const IsoDateTimeSchema = z
  .string()
  .refine((value) => ISO_DATE_TIME_WITH_ZONE.safeParse(value).success, {
    message: "Expected ISO 8601 with a zone, e.g. 2026-10-08T10:00:00Z",
  });
