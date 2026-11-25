import type { Request, Response } from "express";
import { ipKeyGenerator } from "express-rate-limit";
import { pool } from "@workspace/db";
import { hashIdentity, RuleError } from "./judging";

// No process-local counters or fail-open fallback. Database time is authoritative.
// IP ceilings allow 20 active room groups on one venue network. Device/member
// limits retain the previous 20 creations/hour and 600 writes/minute budgets.
export const roomRatePolicies = {
  createNetwork: { name: "create-network", limit: 400, windowMs: 3600000 },
  createDevice: { name: "create-device", limit: 20, windowMs: 3600000 },
  writeNetwork: { name: "write-network", limit: 12000, windowMs: 60000 },
  writeAnonymous: { name: "write-anonymous", limit: 600, windowMs: 60000 },
  writeMember: { name: "write-member", limit: 600, windowMs: 60000 },
} as const;
type Policy = (typeof roomRatePolicies)[keyof typeof roomRatePolicies];

// Hash IPs and cookie-derived identities before persistence; never store bearer
// values. Normalize IPv6 /56 so rotating addresses within a subnet cannot evade.
export const rateKey = (policy: Policy, subject: string) =>
  `${policy.name}:${hashIdentity(subject)}`;
export const networkSubject = (req: Request) =>
  ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? "unknown");

export async function enforceRoomRateLimit(policy: Policy, subject: string, res: Response): Promise<void> {
  const result = await pool.query<{ hits: number; retry_after: number }>(`
    INSERT INTO judging_rate_limits AS counters (key, hits, reset_at)
    VALUES ($1, 1, statement_timestamp() + $2 * INTERVAL '1 millisecond')
    ON CONFLICT (key) DO UPDATE SET
      hits = CASE WHEN counters.reset_at <= statement_timestamp() THEN 1
                  ELSE LEAST(counters.hits + 1, $3 + 1) END,
      reset_at = CASE WHEN counters.reset_at <= statement_timestamp()
                     THEN statement_timestamp() + $2 * INTERVAL '1 millisecond'
                     ELSE counters.reset_at END
    RETURNING hits,
      GREATEST(1, CEIL(EXTRACT(EPOCH FROM (reset_at - statement_timestamp()))))::int AS retry_after
  `, [rateKey(policy, subject), policy.windowMs, policy.limit]);
  const { hits, retry_after: retryAfter } = result.rows[0];
  // The last evaluated policy is the limiting policy on 429. Do not expose keys.
  res.set({
    "RateLimit-Limit": String(policy.limit),
    "RateLimit-Remaining": String(Math.max(0, policy.limit - hits)),
    "RateLimit-Reset": String(retryAfter),
  });
  if (hits > policy.limit) {
    res.set("Retry-After", String(retryAfter));
    throw new RuleError(policy.windowMs === 60000
      ? "操作が集中しています。1分ほど待ってお試しください"
      : "ルーム作成が集中しています。時間をおいてお試しください", 429);
  }
}
