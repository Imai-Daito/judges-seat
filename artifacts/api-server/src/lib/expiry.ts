import { pool } from "@workspace/db";
import { logger } from "./logger";

export async function cleanExpiredRecords(): Promise<void> {
  // A failure in one store must not prevent independent expiry in the other.
  for (const target of [
    { table: "judging_rooms", deadline: "expires_at" },
    { table: "judging_rate_limits", deadline: "reset_at" },
  ] as const) {
    try {
      const result = await pool.query(`DELETE FROM ${target.table} WHERE ${target.deadline} <= NOW()`);
      if (result.rowCount) logger.info({ table: target.table, count: result.rowCount }, "Expired records removed");
    } catch (err) {
      logger.error({ err, table: target.table }, "Expired record cleanup failed");
    }
  }
}

export function startExpiryCleanup() {
  void cleanExpiredRecords();
  const timer = setInterval(() => void cleanExpiredRecords(), 60 * 60 * 1000);
  timer.unref();
}
