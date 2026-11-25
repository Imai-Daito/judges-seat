import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { RuleError } from "./lib/judging";
import type { ErrorRequestHandler } from "express";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0]?.replace(/(\/rooms\/)[^/]+/, "$1[room]").replace(/(\/shared-results\/)[^/]+/, "$1[token]"),
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.set("trust proxy", 1);
app.use(cookieParser());
app.use(express.json({ limit: "24kb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
const errors: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof RuleError) { res.status(err.status).json({ error: err.message }); return; }
  if (err?.name === "ZodError" || err?.type === "entity.parse.failed") { res.status(400).json({ error: "入力内容を確認してください" }); return; }
   // Database errors can include bind values (bearer links). Do not log the error object.
   req.log.error({ errorName: err instanceof Error ? err.name : "UnknownError" }, "Room request failed");
  res.status(500).json({ error: "保存できませんでした。通信を確認してもう一度お試しください" });
};
app.use(errors);

export default app;
