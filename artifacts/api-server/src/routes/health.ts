import { Router, type IRouter } from "express";
import { HealthCheckResponse, ReadinessCheckResponse, type NotReadyStatus } from "@workspace/api-zod";
import { isDatabaseReady } from "../lib/runtime-readiness";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/readyz", async (_req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  if (await isDatabaseReady()) {
    res.json(ReadinessCheckResponse.parse({ status: "ok" }));
  } else {
    res.status(503).json({ status: "unavailable" } satisfies NotReadyStatus);
  }
});

export default router;
