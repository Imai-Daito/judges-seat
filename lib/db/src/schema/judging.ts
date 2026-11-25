import { pgTable, text, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod/v4";

export const judgingRooms = pgTable("judging_rooms", {
  id: text("id").primaryKey(),
  state: jsonb("state").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, table => [
  index("judging_rooms_expiry_idx").on(table.expiresAt),
  uniqueIndex("judging_rooms_result_token_idx").on(sql`(${table.state}->>'resultToken')`),
]);
export const insertJudgingRoomSchema = createInsertSchema(judgingRooms);
export type InsertJudgingRoom = z.infer<typeof insertJudgingRoomSchema>;
export type JudgingRoom = typeof judgingRooms.$inferSelect;
