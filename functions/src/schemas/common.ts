/**
 * Shared schema primitives used across content / generation / config docs.
 * Each typed doc collection's schema lives in its own file alongside this one.
 */
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";

/**
 * Firestore Timestamp validator. We accept either a real Timestamp instance
 * (server reads) or a serialized form `{seconds, nanoseconds}` (client writes
 * via Firestore SDK). Either way, we normalize to a Timestamp on parse.
 */
export const TimestampSchema = z
  .union([
    z.instanceof(Timestamp),
    z.object({ seconds: z.number(), nanoseconds: z.number() }),
  ])
  .transform((v) => (v instanceof Timestamp ? v : new Timestamp(v.seconds, v.nanoseconds)));

export const StatusSchema = z.enum(["initializing", "streaming", "ready", "error", "reverting"]);
export type Status = z.infer<typeof StatusSchema>;

export const StatusLogEntrySchema = z.object({
  at: TimestampSchema,
  message: z.string(),
  source: z.enum(["system", "model"]),
});
export type StatusLogEntry = z.infer<typeof StatusLogEntrySchema>;

export const CountsSchema = z
  .object({
    lessons: z.number().int().nonnegative().optional(),
    entries: z.number().int().nonnegative().optional(),
    plans: z.number().int().nonnegative().optional(),
    games: z.number().int().nonnegative().optional(),
  })
  .strict();
export type Counts = z.infer<typeof CountsSchema>;

export const LanguagePairSchema = z.object({
  source: z.literal("en"),
  target: z.literal("el"),
});
export type LanguagePair = z.infer<typeof LanguagePairSchema>;
