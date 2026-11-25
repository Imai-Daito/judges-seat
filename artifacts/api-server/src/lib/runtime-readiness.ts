import { pool } from "@workspace/db";
import { logger } from "./logger";

export const READINESS_TIMEOUT_MS = 1000;

// PostgreSQL shutdown also errors idle clients. Without a listener pg would
// crash the process before it could report not-ready or observe recovery.
pool.on("error", () => {
  logger.warn("Idle database connection failed; readiness will be checked again");
});

// Check required columns and SELECT privileges without reading participant data
// or modifying schema. Keep this aligned with the startup schema requirements.
const readinessSql = `SELECT r.id, r.state, r.expires_at, l.key, l.hits, l.reset_at
  FROM judging_rooms r CROSS JOIN judging_rate_limits l LIMIT 0`;

let pending: Promise<boolean> | undefined;

export function isDatabaseReady(): Promise<boolean> {
  // Coalesce concurrent probes, including after an acquisition timeout. pg
  // cannot cancel a queued pool.connect(); keep at most one queued acquisition.
  if (pending) return pending;
  pending = new Promise<boolean>((resolve) => {
    let settled = false;
    let acquiring = true;
    let release: ((discard: boolean) => void) | undefined;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      release?.(!ready);
      if (!acquiring) pending = undefined;
      resolve(ready);
    };
    const timer = setTimeout(() => finish(false), READINESS_TIMEOUT_MS);
    pool.connect((error, client, done) => {
      acquiring = false;
      if (settled) {
        // Acquisition completed after the HTTP deadline: never leak a client.
        done?.(true);
        pending = undefined;
        return;
      }
      if (error || !client) {
        finish(false);
        return;
      }
      const onError = () => finish(false);
      client.on("error", onError);
      release = (discard) => {
        client.removeListener("error", onError);
        done?.(discard);
      };
      // Destroy timed-out/failed connections rather than leaving running SQL
      // behind or returning an uncertain connection to room transactions.
      client.query(readinessSql, (queryError) => finish(!queryError));
    });
  });
  return pending;
}
