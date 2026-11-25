import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod/v4";

export const judgingRateLimits = pgTable("judging_rate_limits", {
  key: text("key").primaryKey(),
  hits: integer("hits").notNull(),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
}, table => [index("judging_rate_limits_reset_idx").on(table.resetAt)]);

export const insertJudgingRateLimitSchema = createInsertSchema(judgingRateLimits);
export type InsertJudgingRateLimit = z.infer<typeof insertJudgingRateLimitSchema>;
export type JudgingRateLimit = typeof judgingRateLimits.$inferSelect;
